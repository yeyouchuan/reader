import _ from 'lodash';
import {
    Also, AuthenticationFailedError, AuthenticationRequiredError,
    RPC_CALL_ENVIRONMENT,
    AutoCastable,
    DownstreamServiceError,
} from 'civkit/civ-rpc';
import { htmlEscape } from 'civkit/escape';
import { marshalErrorLike } from 'civkit/lang';

import type { Context } from 'koa';

import logger from '../services/logger';
import { InjectProperty } from '../services/registry';
import { AsyncLocalContext } from '../services/async-context';

import envConfig from '../shared/services/secrets';
import { JinaEmbeddingsDashboardHTTP } from '../shared/3rd-party/jina-embeddings';
import { JinaEmbeddingsTokenAccount } from '../shared/db/jina-embeddings-token-account';
import { TierFeatureConstraintError } from '../services/errors';

const authDtoLogger = logger.child({ service: 'JinaAuthDTO' });


const THE_VERY_SAME_JINA_EMBEDDINGS_CLIENT = new JinaEmbeddingsDashboardHTTP(envConfig.JINA_EMBEDDINGS_DASHBOARD_API_KEY);

@Also({
    openapi: {
        operation: {
            parameters: {
                'Authorization': {
                    description: htmlEscape`Jina Token for authentication.\n\n` +
                        htmlEscape`- Member of <JinaEmbeddingsAuthDTO>\n\n` +
                        `- Authorization: Bearer {YOUR_JINA_TOKEN}`
                    ,
                    in: 'header',
                    schema: {
                        anyOf: [
                            { type: 'string', format: 'token' }
                        ]
                    }
                }
            }
        }
    }
})
export class JinaEmbeddingsAuthDTO extends AutoCastable {
    uid?: string;
    bearerToken?: string;
    user?: JinaEmbeddingsTokenAccount;

    @InjectProperty(AsyncLocalContext)
    ctxMgr!: AsyncLocalContext;

    jinaEmbeddingsDashboard = THE_VERY_SAME_JINA_EMBEDDINGS_CLIENT;

    static override from(input: any) {
        const instance = super.from(input) as JinaEmbeddingsAuthDTO;

        const ctx = input[RPC_CALL_ENVIRONMENT] as Context;

        if (ctx) {
            const authorization = ctx.get('authorization');

            if (authorization) {
                const authToken = authorization.split(' ')[1] || authorization;
                instance.bearerToken = authToken;
            }

        }

        if (!instance.bearerToken && input._token) {
            instance.bearerToken = input._token;
        }

        return instance;
    }

    async getBrief(ignoreCache?: boolean | string) {
        if (!this.bearerToken) {
            throw new AuthenticationRequiredError({
                message: 'Jina API key is required to authenticate. Please get one from https://jina.ai'
            });
        }

        let firestoreDegradation = false;
        let account;
        try {
            account = await JinaEmbeddingsTokenAccount.fromFirestore(this.bearerToken);
        } catch (err) {
            // FireStore would not accept any string as input and may throw if not happy with it
            firestoreDegradation = true;
            logger.warn(`Firestore issue`, { err });
        }


        const age = account?.lastSyncedAt ? Date.now() - account.lastSyncedAt.valueOf() : Infinity;
        const jitter = Math.ceil(Math.random() * 30 * 1000);

        if (account && !ignoreCache) {
            if ((age < (180_000 - jitter)) && (account.wallet?.total_balance > 0)) {
                this.user = account;
                this.uid = this.user?.user_id;

                return account;
            }
        }

        if (firestoreDegradation) {
            logger.debug(`Using remote UC cached user`);
            let r;
            try {
                r = await this.jinaEmbeddingsDashboard.authorization(this.bearerToken);
            } catch (err: any) {
                if (err?.status === 401) {
                    throw new AuthenticationFailedError({
                        message: 'Invalid API key, please get a new one from https://jina.ai'
                    });
                }
                logger.warn(`Failed load remote cached user: ${err}`, { err });
                throw new DownstreamServiceError(`Failed to authenticate: ${err}`);
            }
            const brief = r?.data;
            const draftAccount = JinaEmbeddingsTokenAccount.from({
                ...account, ...brief, _id: this.bearerToken,
                lastSyncedAt: new Date()
            });
            this.user = draftAccount;
            this.uid = this.user?.user_id;

            return draftAccount;
        }

        try {
            // TODO: go back using validateToken after performance issue fixed
            const r = ((account?.wallet?.total_balance || 0) > 0) ?
                await this.jinaEmbeddingsDashboard.authorization(this.bearerToken) :
                await this.jinaEmbeddingsDashboard.validateToken(this.bearerToken);
            const brief = r.data;
            const draftAccount = JinaEmbeddingsTokenAccount.from({
                ...account, ...brief, _id: this.bearerToken,
                lastSyncedAt: new Date()
            });
            await JinaEmbeddingsTokenAccount.save(draftAccount.degradeForFireStore(), undefined, { merge: true });

            this.user = draftAccount;
            this.uid = this.user?.user_id;

            return draftAccount;
        } catch (err: any) {
            authDtoLogger.warn(`Failed to get user brief: ${err}`, { err: marshalErrorLike(err) });

            if (err?.status === 401) {
                throw new AuthenticationFailedError({
                    message: 'Invalid API key, please get a new one from https://jina.ai'
                });
            }

            if (account) {
                this.user = account;
                this.uid = this.user?.user_id;

                return account;
            }


            throw new DownstreamServiceError(`Failed to authenticate: ${err}`);
        }
    }

    async reportUsage(tokenCount: number, mdl: string, endpoint: string = '/encode') {
        const user = await this.assertUser();
        const uid = user.user_id;
        user.wallet.total_balance -= tokenCount;

        return this.jinaEmbeddingsDashboard.reportUsage(this.bearerToken!, {
            model_name: mdl,
            api_endpoint: endpoint,
            consumer: {
                id: uid,
                user_id: uid,
            },
            usage: {
                total_tokens: tokenCount
            },
            labels: {
                model_name: mdl
            }
        }).then((r) => {
            JinaEmbeddingsTokenAccount.COLLECTION.doc(this.bearerToken!)
                .update({ 'wallet.total_balance': JinaEmbeddingsTokenAccount.OPS.increment(-tokenCount) })
                .catch((err) => {
                    authDtoLogger.warn(`Failed to update cache for ${uid}: ${err}`, { err: marshalErrorLike(err) });
                });

            return r;
        }).catch((err) => {
            user.wallet.total_balance += tokenCount;
            authDtoLogger.warn(`Failed to report usage for ${uid}: ${err}`, { err: marshalErrorLike(err) });
        });
    }

    async solveUID() {
        if (this.uid) {
            this.ctxMgr.set('uid', this.uid);

            return this.uid;
        }

        if (this.bearerToken) {
            await this.getBrief();
            this.ctxMgr.set('uid', this.uid);

            return this.uid;
        }

        return undefined;
    }

    async assertUID() {
        const uid = await this.solveUID();

        if (!uid) {
            throw new AuthenticationRequiredError('Authentication failed');
        }

        return uid;
    }

    async assertUser() {
        if (this.user) {
            return this.user;
        }

        await this.getBrief();

        return this.user!;
    }

    async assertTier(n: number, feature?: string) {
        let user;
        try {
            user = await this.assertUser();
        } catch (err) {
            if (err instanceof AuthenticationRequiredError) {
                throw new AuthenticationRequiredError({
                    message: `Authentication is required to use this feature${feature ? ` (${feature})` : ''}. Please provide a valid API key.`
                });
            }

            throw err;
        }

        const tier = parseInt(user.metadata?.speed_level);
        if (isNaN(tier) || tier < n) {
            throw new TierFeatureConstraintError({
                message: `Your current plan does not support this feature${feature ? ` (${feature})` : ''}. Please upgrade your plan.`
            });
        }

        return true;
    }

    getRateLimits(...tags: string[]) {
        const descs = tags.map((x) => this.user?.customRateLimits?.[x] || []).flat().filter((x) => x.isEffective());

        if (descs.length) {
            return descs;
        }

        return undefined;
    }
}

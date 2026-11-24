import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createDealsService } from '../services/deals.service.js';
import { createGroupBuyService } from '../services/group-buy.service.js';
import type { AppDeps } from '../types/deps.js';

/** Sales, price watches and buyer requests. */
export function createDealsController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createDealsService(deps);
  const groups = createGroupBuyService(deps);
  const read =
    (fn: (user: any, input: any) => Promise<unknown>): RequestHandler =>
    async (req, res) => {
      res.json(await fn(res.locals.user, requestInput(req)));
    };
  const write =
    (fn: (q: any, user: any, input: any) => Promise<unknown>): RequestHandler =>
    (req, res) =>
      mutate(req, res, (q, user) => fn(q, user, requestInput(req)));
  return {
    offers: read(service.offers),
    setSale: write(service.setSale),
    listGroups: read(groups.listGroups),
    searchGroupProducts: read(groups.searchGroupProducts),
    getGroup: read(groups.getGroup),
    startGroup: write(groups.startGroup),
    joinGroup: write(groups.joinGroup),
    leaveGroup: write(groups.leaveGroup),
    inviteToGroup: write(groups.invite),
    listWatches: read(service.listWatches),
    watchPrice: write(service.watchPrice),
    unwatchPrice: write(service.unwatchPrice),
    suggest: read(service.suggest),
    createRequest: write(service.createRequest),
    myRequests: read(service.myRequests),
    sellerRequests: read(service.sellerRequests),
    offer: write(service.offer),
    closeRequest: write(service.closeRequest),
  };
}

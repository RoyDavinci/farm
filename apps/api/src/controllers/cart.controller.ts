import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createCartService } from '../services/cart.service.js';
import type { AppDeps } from '../types/deps.js';

export function createCartController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createCartService(deps);
  const getCart: RequestHandler = async (req, res) => {
    res.json(await service.getCart(res.locals.user, requestInput(req)));
  };
  const addToCart: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.addToCart(q, user, requestInput(req)));
  const updateLine: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.updateLine(q, user, requestInput(req)));
  const removeLine: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.removeLine(q, user, requestInput(req)));
  const checkout: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.checkout(q, user, requestInput(req)));
  return { getCart, addToCart, updateLine, removeLine, checkout };
}

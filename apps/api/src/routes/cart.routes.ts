import { Router } from 'express';
import { createCartController } from '../controllers/cart.controller.js';
import type { AppDeps } from '../types/deps.js';

/** Multi-seller cart; checkout sends one booking request per line. */
export function cartRoutes(deps: AppDeps) {
  const r = Router();
  const c = createCartController(deps);
  r.get('/cart', c.getCart);
  r.post('/cart', c.addToCart);
  r.post('/cart/checkout', c.checkout);
  r.patch('/cart/:id', c.updateLine);
  r.delete('/cart/:id', c.removeLine);
  return r;
}

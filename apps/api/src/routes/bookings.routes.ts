import { Router } from 'express';
import { createBookingsController } from '../controllers/bookings.controller.js';
import type { AppDeps } from '../types/deps.js';

export function bookingsRoutes(deps: AppDeps) {
  const r = Router();
  const c = createBookingsController(deps);
  r.get('/bookings', c.listBookings);
  r.get('/bookings/:id', c.getBooking);
  r.get('/bookings/:id/events', c.listBookingEvents);
  r.post('/bookings', c.createBooking);
  r.post('/bookings/:id/:action', c.performBookingAction);
  return r;
}

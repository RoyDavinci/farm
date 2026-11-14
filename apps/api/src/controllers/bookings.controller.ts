import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createBookingsService } from '../services/booking.service.js';
import type { AppDeps } from '../types/deps.js';

/** Booking lifecycle: request, counteroffer, accept, pay, ready, pickup, cancel. */
export function createBookingsController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createBookingsService(deps);
  const listBookings: RequestHandler = async (req, res) => {
    res.json(await service.listBookings(res.locals.user, requestInput(req)));
  };
  const getBooking: RequestHandler = async (req, res) => {
    res.json(await service.getBooking(res.locals.user, requestInput(req)));
  };
  const listBookingEvents: RequestHandler = async (req, res) => {
    res.json(await service.listBookingEvents(res.locals.user, requestInput(req)));
  };
  const createBooking: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.createBooking(q, user, requestInput(req)));
  const performBookingAction: RequestHandler = async (req, res) => {
    await service.expireDue();
    return mutate(req, res, (q, user) => service.performBookingAction(q, user, requestInput(req)));
  };
  return { listBookings, getBooking, listBookingEvents, createBooking, performBookingAction };
}

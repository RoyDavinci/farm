import { Router } from 'express';
import { createCommunicationsController } from '../controllers/communications.controller.js';
import type { AppDeps } from '../types/deps.js';

export function communicationRoutes(deps: AppDeps) {
  const r = Router();
  const c = createCommunicationsController(deps);
  r.get('/notifications', c.listNotifications);
  r.post('/notifications/read', c.markNotificationsRead);
  r.get('/notification-preferences', c.getNotificationPreferences);
  r.put('/notification-preferences', c.updateNotificationPreferences);
  r.get('/conversations', c.listConversations);
  r.post('/conversations', c.startConversation);
  r.get('/conversations/:id/messages', c.listMessages);
  r.post('/conversations/:id/read', c.markConversationRead);
  r.post('/conversations/:id/messages', c.sendMessage);
  r.get('/me/blocks', c.listBlocks);
  r.put('/me/blocks/:id', c.blockUser);
  r.delete('/me/blocks/:id', c.unblockUser);
  r.post('/reports', c.createReport);
  r.get('/favourites', c.listFavourites);
  r.put('/favourites/:id', c.addFavourite);
  r.delete('/favourites/:id', c.removeFavourite);
  r.get('/sellers/:id', c.getSellerProfile);
  r.get('/bookings/:id/rating', c.getRating);
  r.post('/bookings/:id/rating', c.rateBooking);
  r.get('/admin/reports', c.listReports);
  r.post('/admin/reports/:id/resolve', c.resolveReport);
  r.get('/admin/email-queue', c.listEmailQueue);
  r.post('/admin/email-queue/:id/retry', c.retryEmail);
  r.get('/admin/users', c.listUsers);
  r.post('/admin/users/:id/status', c.setUserStatus);
  return r;
}

import type { RequestHandler } from 'express';
import { requestInput } from '../lib/http.js';
import { createCommunicationsService } from '../services/communications.service.js';
import type { AppDeps } from '../types/deps.js';

export function createCommunicationsController(deps: AppDeps) {
  const { config: c, mutate } = deps;
  const service = createCommunicationsService(deps);
  const listNotifications: RequestHandler = async (req, res) => {
    res.json(await service.listNotifications(res.locals.user, requestInput(req)));
  };
  const markNotificationsRead: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.markNotificationsRead(q, user, requestInput(req)));
  const getNotificationPreferences: RequestHandler = async (req, res) => {
    res.json(await service.getNotificationPreferences(res.locals.user, requestInput(req)));
  };
  const updateNotificationPreferences: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) =>
      service.updateNotificationPreferences(q, user, requestInput(req)),
    );
  const listConversations: RequestHandler = async (req, res) => {
    res.json(await service.listConversations(res.locals.user, requestInput(req)));
  };
  const startConversation: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.startConversation(q, user, requestInput(req)));
  const listMessages: RequestHandler = async (req, res) => {
    res.json(await service.listMessages(res.locals.user, requestInput(req)));
  };
  const markConversationRead: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.markConversationRead(q, user, requestInput(req)));
  const sendMessage: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.sendMessage(q, user, requestInput(req)));
  const listBlocks: RequestHandler = async (req, res) => {
    res.json(await service.listBlocks(res.locals.user, requestInput(req)));
  };
  const blockUser: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.blockUser(q, user, requestInput(req)));
  const unblockUser: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.unblockUser(q, user, requestInput(req)));
  const createReport: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.createReport(q, user, requestInput(req)));
  const listFavourites: RequestHandler = async (req, res) => {
    res.json(await service.listFavourites(res.locals.user, requestInput(req)));
  };
  const addFavourite: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.addFavourite(q, user, requestInput(req)));
  const removeFavourite: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.removeFavourite(q, user, requestInput(req)));
  const getSellerProfile: RequestHandler = async (req, res) => {
    res.json(await service.getSellerProfile(res.locals.user, requestInput(req)));
  };
  const getRating: RequestHandler = async (req, res) => {
    res.json(await service.getRating(res.locals.user, requestInput(req)));
  };
  const rateBooking: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.rateBooking(q, user, requestInput(req)));
  const listReports: RequestHandler = async (req, res) => {
    res.json(await service.listReports(res.locals.user, requestInput(req)));
  };
  const resolveReport: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.resolveReport(q, user, requestInput(req)));
  const listEmailQueue: RequestHandler = async (req, res) => {
    res.json(await service.listEmailQueue(res.locals.user, requestInput(req)));
  };
  const retryEmail: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.retryEmail(q, user, requestInput(req)));
  const listUsers: RequestHandler = async (req, res) => {
    res.json(await service.listUsers(res.locals.user, requestInput(req)));
  };
  const setUserStatus: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.setUserStatus(q, user, requestInput(req)));
  return {
    listNotifications,
    markNotificationsRead,
    getNotificationPreferences,
    updateNotificationPreferences,
    listConversations,
    startConversation,
    listMessages,
    markConversationRead,
    sendMessage,
    listBlocks,
    blockUser,
    unblockUser,
    createReport,
    listFavourites,
    addFavourite,
    removeFavourite,
    getSellerProfile,
    getRating,
    rateBooking,
    listReports,
    resolveReport,
    listEmailQueue,
    retryEmail,
    listUsers,
    setUserStatus,
  };
}

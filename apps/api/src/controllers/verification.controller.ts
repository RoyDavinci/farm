import type { RequestHandler } from 'express';
import multer from 'multer';
import { requestInput } from '../lib/http.js';
import {
  createPublicDocumentService,
  createVerificationService,
} from '../services/verification.service.js';
import type { AppDeps } from '../types/deps.js';

export function createVerificationController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createVerificationService(deps);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });
  const listMyDocuments: RequestHandler = async (req, res) => {
    res.json(await service.listMyDocuments(res.locals.user, requestInput(req)));
  };
  const uploadDocument: RequestHandler[] = [
    upload.single('file'),
    async (req, res) => {
      res.status(201).json(await service.uploadDocument(res.locals.user, requestInput(req)));
    },
  ];
  const listDocuments: RequestHandler = async (req, res) => {
    res.json(await service.listDocuments(res.locals.user, requestInput(req)));
  };
  const getDocumentLink: RequestHandler = async (req, res) => {
    res.json(await service.getDocumentLink(res.locals.user, requestInput(req)));
  };
  const reviewDocument: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.reviewDocument(q, user, requestInput(req)));
  return { listMyDocuments, uploadDocument, listDocuments, getDocumentLink, reviewDocument };
}

export function createPublicDocumentController(deps: AppDeps) {
  const service = createPublicDocumentService(deps);
  const downloadDocument: RequestHandler = async (req, res) => {
    const doc = await service.readSignedDocument(requestInput(req));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
    res.type(doc.mimeType).send(doc.buffer);
  };
  return { downloadDocument };
}

import type { RequestHandler } from 'express';
import multer from 'multer';
import { requestInput } from '../lib/http.js';
import {
  createPublicEvidenceService,
  createSupportService,
  resolveSupportCase,
} from '../services/support.service.js';
import type { AppDeps } from '../types/deps.js';
import { resolveDisputeInput } from '../validators/support.validators.js';

export function createSupportController(deps: AppDeps) {
  const { mutate } = deps;
  const service = createSupportService(deps);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  const listDisputes: RequestHandler = async (req, res) => {
    res.json(await service.listDisputes(res.locals.user, requestInput(req)));
  };
  const getBookingDispute: RequestHandler = async (req, res) => {
    res.json(await service.getBookingDispute(res.locals.user, requestInput(req)));
  };
  const openDispute: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.openDispute(q, user, requestInput(req)));
  const getDispute: RequestHandler = async (req, res) => {
    res.json(await service.getDispute(res.locals.user, requestInput(req)));
  };
  const uploadEvidence: RequestHandler[] = [
    async (req, res, next) => {
      res.locals.dispute = await service.openCaseForEvidence(res.locals.user, requestInput(req));
      next();
    },
    upload.single('file'),
    async (req, res) => {
      res
        .status(201)
        .json(await service.addEvidence(res.locals.user, requestInput(req), res.locals.dispute));
    },
  ];
  const getEvidenceLink: RequestHandler = async (req, res) => {
    res.json(await service.getEvidenceLink(res.locals.user, requestInput(req)));
  };
  const downloadEvidence: RequestHandler = async (req, res) => {
    const file = await service.readEvidence(res.locals.user, requestInput(req));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.type(file.mimeType);
    if (file.url) return res.redirect(file.url);
    res.send(file.buffer);
  };
  const updateReturn: RequestHandler = (req, res) =>
    mutate(req, res, (q, user) => service.updateReturn(q, user, requestInput(req)));
  const listAllDisputes: RequestHandler = async (req, res) => {
    res.json(await service.listAllDisputes(res.locals.user, requestInput(req)));
  };
  // Staff role checks for /admin paths happen in middleware/require-staff.ts.
  const resolveDispute: RequestHandler = async (req, res) => {
    const data = resolveDisputeInput.parse(req.body);
    return mutate(req, res, (q, u) => resolveSupportCase(q, u, req.params.id as string, data));
  };
  const getReceipt: RequestHandler = async (req, res) => {
    res.json(await service.getReceipt(res.locals.user, requestInput(req)));
  };
  return {
    listDisputes,
    getBookingDispute,
    openDispute,
    getDispute,
    uploadEvidence,
    getEvidenceLink,
    downloadEvidence,
    updateReturn,
    listAllDisputes,
    resolveDispute,
    getReceipt,
  };
}

export function createPublicEvidenceController(deps: AppDeps) {
  const service = createPublicEvidenceService(deps);
  const downloadEvidence: RequestHandler = async (req, res) => {
    const file = await service.readSignedEvidence(requestInput(req));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.type(file.mimeType).send(file.buffer);
  };
  return { downloadEvidence };
}

// POST /api/plan
import { handlePlan } from '../../shared/manga-core.js';
import { makeHandler } from '../../shared/pages-function.js';

export const onRequestPost = makeHandler(handlePlan);

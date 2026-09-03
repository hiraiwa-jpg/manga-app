// POST /api/assist
import { handleAssist } from '../../shared/manga-core.js';
import { makeHandler } from '../../shared/pages-function.js';

export const onRequestPost = makeHandler(handleAssist);

// POST /api/generate
import { handleGenerate } from '../../shared/manga-core.js';
import { makeHandler } from '../../shared/pages-function.js';

export const onRequestPost = makeHandler(handleGenerate);

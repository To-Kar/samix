import { PrismaClient } from '@prisma/client';
import { ensureDatabaseUrl } from './location.js';

ensureDatabaseUrl();

export const prisma = new PrismaClient();

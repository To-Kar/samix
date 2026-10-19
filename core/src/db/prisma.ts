import { PrismaClient } from '@prisma/client';
import { ensureDatabaseUrl } from './paths.js';

ensureDatabaseUrl();

export const prisma = new PrismaClient();

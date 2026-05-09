import { EventEmitter } from 'node:events';

export const coreEvents = new EventEmitter();
coreEvents.setMaxListeners(50);

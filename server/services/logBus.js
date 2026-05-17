'use strict';

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0);

function emit(projectId, event) {
  if (!projectId) return;
  bus.emit(`p:${projectId}`, { ts: Date.now(), ...event });
}

function subscribe(projectId, handler) {
  const key = `p:${projectId}`;
  bus.on(key, handler);
  return () => bus.off(key, handler);
}

module.exports = { emit, subscribe };

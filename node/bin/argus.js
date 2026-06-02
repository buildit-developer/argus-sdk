#!/usr/bin/env node
'use strict'

const { spawn } = require('child_process')
const path = require('path')

// Set up OTel provider in THIS process before spawning child
// (child process inherits env, OTel is set up there via register.mjs)


const args = process.argv.slice(2)

if (!args.length) {
  console.error('Usage: argus node <script> [...args]')
  process.exit(1)
}

// Strip optional 'node' prefix: `argus node app.js` or just `argus app.js`
if (args[0] === 'node') args.shift()

const registerPath = path.resolve(__dirname, '../register.mjs')

const child = spawn(
  process.execPath,
  ['--import', `file://${registerPath}`, ...args],
  { stdio: 'inherit', env: process.env }
)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

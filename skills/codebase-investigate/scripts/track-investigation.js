#!/usr/bin/env node

/**
 * 调查范围追踪脚本
 *
 * 功能：记录所有 Read/Grep 操作到追踪文件
 * 触发：PostToolUse hook，当 tool == 'Read' || tool == 'Grep'
 *
 * 用法：node track-investigation.js "<tool_input_json>"
 */

const fs = require('fs');
const path = require('path');

// 追踪文件路径
const TRACKING_DIR = '.claude/investigation';
const TRACKING_FILE = path.join(TRACKING_DIR, 'scope-tracking.log');

/**
 * 确保追踪目录存在
 */
function ensureTrackingDir() {
  if (!fs.existsSync(TRACKING_DIR)) {
    fs.mkdirSync(TRACKING_DIR, { recursive: true });
  }
}

/**
 * 解析工具输入
 */
function parseToolInput(inputStr) {
  try {
    return JSON.parse(inputStr);
  } catch (e) {
    // 如果不是 JSON，可能是简单字符串
    return { raw: inputStr };
  }
}

/**
 * 格式化追踪记录
 */
function formatTrackingEntry(toolInput) {
  const timestamp = new Date().toISOString();
  const parsed = parseToolInput(toolInput);

  let entry = `[${timestamp}] `;

  if (parsed.file_path) {
    // Read tool
    entry += `READ: ${parsed.file_path}`;
    if (parsed.offset || parsed.limit) {
      entry += ` (lines ${parsed.offset || 0}-${(parsed.offset || 0) + (parsed.limit || 'end')})`;
    }
  } else if (parsed.pattern) {
    // Grep tool
    entry += `GREP: pattern="${parsed.pattern}"`;
    if (parsed.path) {
      entry += ` in ${parsed.path}`;
    }
    if (parsed.glob) {
      entry += ` glob="${parsed.glob}"`;
    }
  } else if (parsed.raw) {
    entry += `INPUT: ${parsed.raw}`;
  } else {
    entry += `UNKNOWN: ${JSON.stringify(parsed)}`;
  }

  return entry + '\n';
}

/**
 * 追加追踪记录
 */
function appendTracking(entry) {
  ensureTrackingDir();
  fs.appendFileSync(TRACKING_FILE, entry);
}

/**
 * 主函数
 */
function main() {
  const toolInput = process.argv[2];

  if (!toolInput) {
    console.error('Usage: node track-investigation.js "<tool_input>"');
    process.exit(1);
  }

  const entry = formatTrackingEntry(toolInput);
  appendTracking(entry);

  // 静默成功，不输出任何内容（避免干扰 Claude 的输出）
}

main();

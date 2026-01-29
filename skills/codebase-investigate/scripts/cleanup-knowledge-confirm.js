#!/usr/bin/env node

/**
 * cleanup-knowledge-confirm.js
 *
 * PostToolUse hook 脚本：在成功写入术语表或知识库后清理确认文件。
 * 实现「一次确认一次操作」原则。
 *
 * 退出码：始终返回 0（清理失败不阻止流程）
 */

const fs = require('fs');
const path = require('path');

// 确认文件路径
const GLOSSARY_CONFIRM = '.claude/glossary-write-confirmed.json';
const KNOWLEDGE_CONFIRM = '.claude/knowledge-write-confirmed.json';

/**
 * 从 tool_input JSON 中提取目标文件路径
 */
function extractTargetFile(toolInputJson) {
  try {
    const input = JSON.parse(toolInputJson);
    return input.file_path || null;
  } catch (e) {
    return null;
  }
}

/**
 * 判断是否是术语表文件
 */
function isGlossaryFile(filePath) {
  if (!filePath) return false;
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.endsWith('/glossary.md') || normalizedPath === 'glossary.md';
}

/**
 * 判断是否是知识库文件
 */
function isKnowledgeFile(filePath) {
  if (!filePath) return false;
  const normalizedPath = filePath.replace(/\\/g, '/');
  return /\.claude\/knowledge\/.*\.md$/.test(normalizedPath);
}

/**
 * 清理确认文件
 */
function cleanupConfirmation(confirmFile) {
  const confirmPath = path.resolve(process.cwd(), confirmFile);
  try {
    if (fs.existsSync(confirmPath)) {
      fs.unlinkSync(confirmPath);
      console.log(`[清理] 已删除确认文件: ${confirmFile}`);
    }
  } catch (e) {
    console.warn(`[清理警告] 无法删除确认文件: ${e.message}`);
  }
}

/**
 * 主函数
 */
function main() {
  const toolInputJson = process.argv[2];

  if (!toolInputJson) {
    process.exit(0);
  }

  const targetFile = extractTargetFile(toolInputJson);

  // 术语表写入成功后清理
  if (isGlossaryFile(targetFile)) {
    cleanupConfirmation(GLOSSARY_CONFIRM);
  }

  // 知识库写入成功后清理
  if (isKnowledgeFile(targetFile)) {
    cleanupConfirmation(KNOWLEDGE_CONFIRM);
  }

  process.exit(0);
}

main();

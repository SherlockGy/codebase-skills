#!/usr/bin/env node

/**
 * check-knowledge-write.js
 *
 * PreToolUse hook 脚本：在写入术语表或知识库前检查用户确认。
 * 防止 AI 在调查过程中自动沉淀，确保"发现 ≠ 沉淀"原则。
 *
 * 检查目标：
 * - glossary.md（术语表）
 * - .claude/knowledge/*.md（知识库）
 *
 * 确认机制：
 * - 用户调用 glossary-manager 或 knowledge-manager 时，skill 会创建确认文件
 * - 本脚本检查确认文件存在才允许写入
 *
 * 退出码：
 * - 0: 允许写入
 * - 2: 阻止写入（缺少用户确认）
 */

const fs = require('fs');
const path = require('path');

// 确认文件路径
const GLOSSARY_CONFIRM = '.claude/glossary-write-confirmed.json';
const KNOWLEDGE_CONFIRM = '.claude/knowledge-write-confirmed.json';

// 确认文件有效期（5分钟）
const CONFIRM_VALIDITY_MS = 5 * 60 * 1000;

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
 * 检查确认文件是否有效
 * @param {string} confirmFile - 确认文件路径
 * @returns {object} { valid: boolean, error: string|null }
 */
function checkConfirmation(confirmFile) {
  const confirmPath = path.resolve(process.cwd(), confirmFile);

  if (!fs.existsSync(confirmPath)) {
    return { valid: false, error: '未找到用户确认文件' };
  }

  try {
    const content = fs.readFileSync(confirmPath, 'utf8');
    const confirmed = JSON.parse(content);

    // 检查必需字段
    if (!confirmed.user_confirmed) {
      return { valid: false, error: '确认文件中 user_confirmed 为 false' };
    }

    // 检查是否过期
    if (confirmed.confirmed_at) {
      const confirmedTime = new Date(confirmed.confirmed_at).getTime();
      // Fix: 添加 NaN 检查防止无效日期
      if (isNaN(confirmedTime)) {
        return { valid: false, error: '确认文件中 confirmed_at 格式错误' };
      }
      const now = Date.now();
      if (now - confirmedTime > CONFIRM_VALIDITY_MS) {
        return { valid: false, error: `确认已过期（超过 ${CONFIRM_VALIDITY_MS / 60000} 分钟）` };
      }
    }

    return { valid: true, error: null, action: confirmed.action || 'unknown' };

  } catch (e) {
    return { valid: false, error: `确认文件解析失败: ${e.message}` };
  }
}

/**
 * 清理确认文件（写入成功后）
 */
function cleanupConfirmation(confirmFile) {
  const confirmPath = path.resolve(process.cwd(), confirmFile);
  try {
    if (fs.existsSync(confirmPath)) {
      fs.unlinkSync(confirmPath);
      console.log(`[清理] 已删除确认文件: ${confirmFile}`);
    }
  } catch (e) {
    console.warn(`[警告] 无法删除确认文件: ${e.message}`);
  }
}

/**
 * 主函数
 */
function main() {
  const toolInputJson = process.argv[2];

  if (!toolInputJson) {
    console.error('Usage: node check-knowledge-write.js "<tool_input_json>"');
    process.exit(0); // 用法错误不阻止
  }

  const targetFile = extractTargetFile(toolInputJson);

  // 检查是否是术语表
  if (isGlossaryFile(targetFile)) {
    console.log(`[知识沉淀检查] 检测到术语表写入: glossary.md`);

    const check = checkConfirmation(GLOSSARY_CONFIRM);
    if (!check.valid) {
      console.error(`\n❌ 阻止操作：写入术语表需要用户确认\n`);
      console.error(`错误：${check.error}\n`);
      console.error(`请先通过 /glossary-manager 添加或更新术语。`);
      console.error(`直接修改 glossary.md 不被允许，以确保"发现 ≠ 沉淀"原则。\n`);
      process.exit(2);
    }

    console.log(`✓ 用户已确认术语表操作: ${check.action}`);
    // 不在这里清理，让 PostToolUse 清理或自然过期
    process.exit(0);
  }

  // 检查是否是知识库
  if (isKnowledgeFile(targetFile)) {
    console.log(`[知识沉淀检查] 检测到知识库写入: ${path.basename(targetFile)}`);

    const check = checkConfirmation(KNOWLEDGE_CONFIRM);
    if (!check.valid) {
      console.error(`\n❌ 阻止操作：写入知识库需要用户确认\n`);
      console.error(`错误：${check.error}\n`);
      console.error(`请先通过 /knowledge-manager 添加或确认规则。`);
      console.error(`直接修改知识库不被允许，以确保"发现 ≠ 沉淀"原则。\n`);
      process.exit(2);
    }

    console.log(`✓ 用户已确认知识库操作: ${check.action}`);
    process.exit(0);
  }

  // 非术语表/知识库文件，放行
  process.exit(0);
}

main();

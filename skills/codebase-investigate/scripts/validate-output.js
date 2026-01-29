#!/usr/bin/env node

/**
 * 输出格式验证脚本
 *
 * 功能：验证报告文件的格式是否符合要求
 * 触发：PostToolUse hook，当写入 investigation/*-report.md 时
 *
 * 验证内容：
 * 1. 文件包含 YAML frontmatter
 * 2. frontmatter 包含必需字段（stage, timestamp）
 * 3. 文件包含「调查范围」或「扫描范围」或「追踪范围」章节
 *
 * 用法：node validate-output.js "<file_path>"
 */

const fs = require('fs');
const path = require('path');

/**
 * 解析 YAML frontmatter
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }

  const yaml = match[1];
  const fields = {};

  yaml.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      fields[key] = value;
    }
  });

  return fields;
}

/**
 * 验证必需字段
 */
function validateRequiredFields(frontmatter, requiredFields) {
  const missing = [];
  for (const field of requiredFields) {
    if (!frontmatter[field]) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * 验证包含范围说明章节
 */
function validateScopeSection(content) {
  const scopePatterns = [
    /##\s*调查范围/,
    /##\s*扫描范围/,
    /##\s*追踪范围/,
    /###\s*扫描范围说明/,
    /###\s*追踪范围说明/,
  ];

  return scopePatterns.some(pattern => pattern.test(content));
}

/**
 * 主函数
 */
function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: node validate-output.js "<file_path>"');
    process.exit(1);
  }

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    console.error(`[验证警告] 文件不存在: ${filePath}`);
    process.exit(0); // 不阻止流程
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const errors = [];
  const warnings = [];

  // 验证 frontmatter
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    errors.push('缺少 YAML frontmatter（文件应以 --- 开头）');
  } else {
    // 验证必需字段
    const requiredFields = ['stage', 'timestamp'];
    const missing = validateRequiredFields(frontmatter, requiredFields);
    if (missing.length > 0) {
      errors.push(`frontmatter 缺少必需字段: ${missing.join(', ')}`);
    }
  }

  // 验证范围说明章节
  if (!validateScopeSection(content)) {
    warnings.push('建议添加「调查范围」或「扫描范围」章节');
  }

  // 输出验证结果
  if (errors.length > 0) {
    console.error(`[验证错误] ${filePath}`);
    errors.forEach(e => console.error(`  - ${e}`));
    // 不阻止流程，只是警告
  }

  if (warnings.length > 0) {
    console.warn(`[验证警告] ${filePath}`);
    warnings.forEach(w => console.warn(`  - ${w}`));
  }

  // 验证通过时静默
}

main();

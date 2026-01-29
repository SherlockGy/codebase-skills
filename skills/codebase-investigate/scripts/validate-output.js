#!/usr/bin/env node

/**
 * 输出格式验证脚本
 *
 * 功能：验证报告文件的格式是否符合要求
 * 触发：PostToolUse hook，当 Write 工具被调用时
 *
 * 验证内容：
 * 1. 文件包含 YAML frontmatter
 * 2. frontmatter 包含必需字段（stage, timestamp）
 * 3. 文件包含「调查范围」或「扫描范围」或「追踪范围」章节
 *
 * 注意：PostToolUse 无法阻止已完成的操作，此脚本仅输出警告信息。
 * 真正的阻止逻辑在 PreToolUse 的 check-dependencies.js 中。
 *
 * 退出码：始终返回 0（警告模式，不阻止流程）
 *
 * 用法：node validate-output.js "<tool_input_json>"
 */

const fs = require('fs');
const path = require('path');

/**
 * 从 tool_input JSON 中提取文件路径
 */
function extractFilePath(toolInputJson) {
  try {
    const input = JSON.parse(toolInputJson);
    return input.file_path || null;
  } catch (e) {
    return null;
  }
}

/**
 * 判断是否是调查报告文件
 */
function isInvestigationReport(filePath) {
  if (!filePath) return false;
  const normalizedPath = filePath.replace(/\\/g, '/');
  // Fix-10.1: 修复正则，包含 conclusion.md
  const reportPattern = /investigation\/(scan-report|trace-report|conclusion)\.md$/;
  return reportPattern.test(normalizedPath);
}

/**
 * 解析 YAML frontmatter
 * 改进版：正确处理值中包含冒号的情况
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }

  const yaml = match[1];
  const fields = {};

  yaml.split('\n').forEach(line => {
    // 只分割第一个冒号，值可能包含冒号（如 timestamp: 2024-01-30T12:00:00）
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      // 跳过空值和数组/对象开始符
      if (value && value !== '' && !value.startsWith('-')) {
        fields[key] = value;
      } else if (value === '') {
        // 可能是多行值的开始，标记为存在
        fields[key] = '__multiline__';
      }
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
  const toolInputJson = process.argv[2];

  if (!toolInputJson) {
    console.error('Usage: node validate-output.js "<tool_input_json>"');
    process.exit(0); // 警告模式，不阻止
  }

  const filePath = extractFilePath(toolInputJson);

  // 只验证调查报告文件
  if (!isInvestigationReport(filePath)) {
    process.exit(0);
  }

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    console.warn(`[验证警告] 文件不存在: ${filePath}`);
    process.exit(0); // 警告模式，不阻止
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
    console.warn(`[格式警告] ${path.basename(filePath)}`);
    errors.forEach(e => console.warn(`  ⚠ ${e}`));
  }

  if (warnings.length > 0) {
    console.warn(`[格式建议] ${path.basename(filePath)}`);
    warnings.forEach(w => console.warn(`  ℹ ${w}`));
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`[格式验证] ${path.basename(filePath)} ✓`);
  }

  // 始终返回 0（警告模式，PostToolUse 无法阻止操作）
  process.exit(0);
}

main();

#!/bin/bash
# VPS 一键更新部署脚本
# 用法：ssh root@VPS_IP 'cd /opt/xhs-marketing && bash deploy.sh'

set -e
echo "🔄 Pulling latest from GitHub..."
git pull origin main

echo "🐳 Rebuilding tools container..."
docker compose build tools

echo "♻️  Restarting containers..."
docker compose up -d

echo "✅ Deployed! Running containers:"
docker compose ps

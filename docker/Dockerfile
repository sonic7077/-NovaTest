# 测试平台运行镜像。
# 基础镜像版本必须与 package-lock.json 中 playwright 的版本一致（1.61.1），
# 否则容器内浏览器 revision 对不上，chromium.launch 会失败。
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# 镜像已预装浏览器（PLAYWRIGHT_BROWSERS_PATH 指向 /ms-playwright），跳过下载
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

ENV HOST=0.0.0.0 \
    PORT=4173
EXPOSE 4173

CMD ["node", "server/index.js"]

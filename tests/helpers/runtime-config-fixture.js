export const completeRuntimeConfig = {
  model: { baseUrl: 'https://model.example/api', modelName: 'vision-model', modelFamily: 'gemini', apiKey: 'model-secret', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
  cms: {
    baseUrl: 'https://cms.example/api.php', key: 'aes-key', iv: 'aes-iv', appKey: 'app-key', username: 'cms-admin', password: 'cms-password', googleSecret: 'google-secret',
    oauthId: 'oauth-id', oauthType: 'oauth-type', version: '1.0.0', bundleId: 'bundle-id', language: 'zh-CN', via: 'web'
  },
  lighthouse: { projectName: '默认项目', email: 'tester@example.test', password: 'lighthouse-password', totpSecret: 'TOTPSECRET' }
};

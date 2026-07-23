# CMS 自动响应解密 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动解密无 `crypt` 标识的 CMS 响应，并在报告中安全展示解密后的业务 JSON。

**Architecture:** `CmsApiRunner` 新增局部响应解析方法，显式加密响应必须解密，未标记的字符串响应则尝试解密后安全回退。加密传输与业务对象使用不同脱敏函数，避免业务 JSON 的 `data` 字段被错误当作传输密文隐藏。

**Tech Stack:** Node.js 22、Node Crypto AES-128-CBC、Express、Vitest、SQLite。

## Global Constraints

- CMS 密钥、IV、appKey、账号、密码、token、传输密文和签名只存在于运行时；不得写入源码、测试夹具、报告、SQLite 证据或提交。
- `config` 是只读接口；真实验证不得发起任何写操作。
- 显式 `crypt` 响应解密失败必须使步骤失败；无标识字符串响应仅在解密并解析 JSON 成功时采用解密结果。
- 业务响应中的 `data` 字段必须保留；token、密码、密钥、IV 与签名的值显示为 `********`。

---

### Task 1: 兼容解密 CMS 响应并区分业务脱敏

**Files:**
- Modify: `server/services/cms-crypto.js:1-32`
- Modify: `server/runners/cms-api-runner.js:1-65`
- Modify: `tests/cms-crypto.test.js:14-33`
- Modify: `tests/cms-api-runner.test.js:6-151`

**Interfaces:**
- Consumes: 外层 CMS 响应 `{ status|errcode, crypt?, data }`。
- Produces: `CmsApiRunner.request()` 的 `data` 为已解密业务值或普通明文业务值，`api.response` 为已脱敏业务证据。
- Produces: `redactTransportSecrets(value)` 隐藏传输 `data`、`sign` 及认证字段；`redactBusinessSecrets(value)` 保留业务 `data`，隐藏 token、密码、密钥、IV 与签名。

- [ ] **Step 1: 写入失败测试**

在 `tests/cms-api-runner.test.js` 添加无 `crypt` 标识的加密响应帮助函数与测试：

```js
function unmarkedEncryptedResponse(data) {
  return { status: 1, data: encryptPayload(JSON.stringify(data), cryptoConfig) };
}

it('decrypts an unmarked encrypted business response and preserves its data object', async () => {
  const runner = new CmsApiRunner({
    config: { ...cryptoConfig, username: 'admin', password: 'password', oauthId: 'qa', oauthType: 'web', version: '1.0.0' },
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      json: async () => new URL(url).pathname.endsWith('/loginByPassword')
        ? { status: 1, data: 'token-1' }
        : unmarkedEncryptedResponse({ data: { config: { featureEnabled: true } }, token: 'secret-token' })
    })
  });

  const result = await runner.execute({ id: 'config', request: { action: 'config', method: 'POST', payload: {}, expectedStatus: 1, safety: 'readonly' } }, { testCase: { baseUrl: 'https://example.test' }, variables: {} });

  expect(result.api.response).toEqual({ data: { config: { featureEnabled: true } }, token: '********' });
});
```

将 `tests/cms-crypto.test.js` 的导入更新为包含 `redactBusinessSecrets`，并增加业务脱敏断言：

```js
expect(redactBusinessSecrets({ data: { config: { enabled: true } }, sign: 'secret-sign' })).toEqual({
  data: { config: { enabled: true } },
  sign: '********'
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/cms-crypto.test.js tests/cms-api-runner.test.js`

Expected: FAIL，因为未标记密文不会解密，且业务脱敏函数尚不存在。

- [ ] **Step 3: 最小实现**

在 `server/services/cms-crypto.js` 提供两个脱敏函数：

```js
const TRANSPORT_SECRET_KEY = /token|password|data|sign|key|iv/i;
const BUSINESS_SECRET_KEY = /token|password|sign|key|iv/i;

function redactByKey(value, secretKey) {
  if (Array.isArray(value)) return value.map((item) => redactByKey(item, secretKey));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? SECRET_MASK : redactByKey(item, secretKey)]));
}

export const redactTransportSecrets = (value) => redactByKey(value, TRANSPORT_SECRET_KEY);
export const redactBusinessSecrets = (value) => redactByKey(value, BUSINESS_SECRET_KEY);
export const redactSecrets = redactTransportSecrets;
```

在 `server/runners/cms-api-runner.js` 添加响应解析函数，并在 `request()` 中替换当前 `outer.crypt` 条件：

```js
function parseEncryptedResponse(data, config) {
  return JSON.parse(decryptPayload(data, config));
}

function responseData(outer, config) {
  if (outer.crypt) return parseEncryptedResponse(outer.data, config);
  if (typeof outer.data !== 'string') return outer.data;
  try { return parseEncryptedResponse(outer.data, config); }
  catch { return outer.data; }
}
```

将业务证据改为 `redactBusinessSecrets(data)`，请求摘要仍使用 `redactTransportSecrets(payload)`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- tests/cms-crypto.test.js tests/cms-api-runner.test.js`

Expected: PASS；带标识响应、无标识加密响应、明文登录响应与会话复用保持可用。

- [ ] **Step 5: 提交**

```bash
git add server/services/cms-crypto.js server/runners/cms-api-runner.js tests/cms-crypto.test.js tests/cms-api-runner.test.js
git commit -m "fix: decrypt unmarked CMS responses"
```

### Task 2: 报告保留业务 data 并验证真实 config 响应

**Files:**
- Modify: `server/services/report-service.js:1-25`
- Modify: `tests/app.test.js:261-282`
- Verify: `http://127.0.0.1:4173/api/cases/:id/runs` 与 `/api/runs/:id/report`

**Interfaces:**
- Consumes: `step.api.response`，其值为 Task 1 的已解密业务对象。
- Produces: “解密后响应”报告区块，保留业务 `data` 对象并隐藏敏感字段。

- [ ] **Step 1: 写入失败测试**

更新 `tests/app.test.js` 的 API 报告测试，使用以下响应并断言嵌套业务结构可见：

```js
response: {
  data: { config: { featureEnabled: true } },
  token: 'secret-token'
}

expect(report).toContain('&quot;config&quot;');
expect(report).toContain('&quot;featureEnabled&quot;');
expect(report).toContain('********');
expect(report).not.toContain('secret-token');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/app.test.js`

Expected: FAIL，因为报告仍使用传输层脱敏函数，会将业务 `data` 整体替换为星号。

- [ ] **Step 3: 最小实现**

将 `server/services/report-service.js` 的导入与响应处理替换为：

```js
import { redactBusinessSecrets, redactTransportSecrets } from './cms-crypto.js';

const request = redactTransportSecrets(api.request);
const response = redactBusinessSecrets(api.response);
```

保留现有“请求摘要”和“解密后响应”HTML 结构，不增加原始响应或密文展示。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- tests/app.test.js tests/cms-crypto.test.js tests/cms-api-runner.test.js`

Expected: PASS；报告显示业务 `data.config`，敏感字段仍为 `********`。

- [ ] **Step 5: 重启服务并复测 config 用例**

重启 `node server/index.js` 以加载新代码。通过现有“CMS config 解密验证”用例发起一次单条运行，仅输出非敏感验证结果：运行状态、响应是否为对象、业务 `data` 是否为对象、报告是否包含“解密后响应”和业务字段名、是否包含 `********`。不得输出响应正文、基础地址、密钥、token、密文或签名。

- [ ] **Step 6: 提交仅代码变更**

```bash
git add server/services/report-service.js tests/app.test.js
git commit -m "feat: render decrypted CMS business data"
```

不提交 SQLite 数据库、运行报告、证据目录、`.env`、`.DS_Store` 或任何运行时凭据。

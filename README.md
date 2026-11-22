# fuyu-plugins

[浮屿 / Fuyu](https://github.com/TixXin/fuyu)（原名 FocuSD Island）插件市场的索引仓库。The plugin market index of Fuyu (formerly FocuSD Island).

仓库原名 `TixXin/focusd-plugins`，2026-11-10 改名；已发布的岛屿仍请求旧地址，由 GitHub 重定向，所以旧名字不能再用来建仓库。点赞帖的地址在 `stars.json` 里仍写旧仓库名，旧版岛屿只认它。The repository was renamed from `TixXin/focusd-plugins`; islands already released reach it through GitHub's redirect, and `stars.json` keeps discussion links under the old name for them.

- **提交插件 / Submit a plugin**：见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- **报告插件问题 / Report a plugin**：[开一个 issue](../../issues/new/choose)。

## 仓库结构

```text
plugins/<id>.json          作者提交：插件仓库、发布者、分类
index.json / index.json.sig       CI 生成并签名，不接受手工修改
revoked.json / revoked.json.sig   下架名单（维护者修改，CI 签名）
stars.json                 各插件的点赞数和点赞帖地址（CI 生成，不签名，只用于显示）
themes/<id>.json           主题：岛屿长什么样（风格、字体、透明度、圆角、颜色），不含尺寸，不运行代码
themes.json                CI 从 themes/ 生成，岛屿的主题市场读它
keys/trusted.json          岛屿信任的签名公钥（与岛屿仓库的 plugins/signing-keys.json 一致）
scripts/                   索引构建、PR 检查、签名

plugins/v3/<作用域>/<名字>.json   第 3 版插件的提交：每个版本一行（版本、仓库、提交号、作者签名）
bundles/<id>.json          套装：几个已上架的插件，岛屿的市场页可以一次装上（只由维护者增删，目前只收 @fuyu 官方插件）
index.v3.json / .sig       第 3 版索引：CI 从提交号构建、发到本仓库 Releases 后生成并签名，不接受手工修改
revoked.v3.json / .sig     第 3 版撤销名单：维护者在自己电脑上用离线的撤销密钥签好再开 PR
keys/trusted.v3.json       第 3 版信任根：索引密钥、撤销密钥两组，同一把不能两边都在（与岛屿编进去的一致）
market/v3/                 第 3 版用的工具（TixXin/fuyu 的固定提交号）和市场构建设置
scripts/v3/                第 3 版的 PR 检查、构建、审核报告、发布、签名
```

## 工作方式

| 工作流 | 触发 | 做什么 |
|---|---|---|
| `Check submission` | 每个 PR | 只读权限、没有密钥。`check`：检查提交格式、所有权，下载并校验插件包，扫描包里遗留的密钥（`scripts/lib/secrets.mjs`），把权限等信息写进运行摘要，跑本仓库的测试。第 3 版另有三个 job：`v3-plan` 验作者签名（官方插件核对提交在 `TixXin/fuyu` 受保护的 `main` 上）和谁能改什么；`v3-build` 每个版本一个，按提交号取源码，`npm ci --ignore-scripts`，用市场的构建设置和固定版本的工具构建，再和上一个上架版本对比审核；`v3-report` 汇总、预演合入后的索引，把报告贴到 PR 上，有问题或红色时失败 |
| `Comment the v3 report` | `Check submission` 跑完 | 只处理 fork 来的 PR（它们的检查只有只读令牌）：取那次检查的报告贴到 PR 上，PR 的最新提交不是检查过的那个就不贴 |
| `Approve routine v3 updates` | `Check submission` 成功跑完 | 协作者给自己已上架的插件发的新版本：PR 只改了 `plugins/v3/<作者>/` 下已有的提交文件，计划没有问题也没有要人看的变化，每个版本和上一版比是绿档、来自同一个仓库，就以 `github-actions` 批准检查过的那个提交（`scripts/v3/approve.mjs`）。首次上架、黄档和别的都等维护者；`market/v3/trusted-authors.json` 里的信任作者，自己作用域的首次上架和黄档也自动批准（换密钥、换仓库或文件夹、紧急、删版本仍等维护者）。只用默认分支的代码，读那次检查的产物；产物可信是因为 PR 只能改数据文件 |
| `Publish v3` | `main` 上第 3 版的文件变化时、每天、手动 | 找出索引里还没有的版本，在没有密钥的 job 里重新构建、审核；能写 Release 的 job 只核对哈希、发 Release（`v3.<作用域>.<名字>@<版本>`）、拼出索引；签名 job 只拿到这个索引，用 `release` 环境的 `FUYU_INDEX_V3_SIGNING_KEY` 签；推送 job 用 `ci-push` 环境的部署密钥提交。每天重签一次（索引 7 天过期）。在别的分支上手动跑是预演：发预发布、用临时密钥签、不推送，跑完删掉 |
| `Update index` | 定时（名义上每小时，GitHub 不保证准点，实际常隔几小时）、`main` 变化时、手动 | 分两个 job：构建 job 没有密钥，找出每个插件的最新 Release、校验后生成 `index.json`；签名 job 只拿到这个文件，不装依赖，用 `release` 环境里的密钥签名；推送 job 用 `ci-push` 环境的部署密钥提交。所有 Actions 按提交号固定 |
| `Update themes` | `main` 上的 `themes/` 变化时、手动 | 校验每个主题（`scripts/lib/themes.mjs`），按官方在前、其余按 id 排序写进 `themes.json` |
| `Update likes` | 每小时、手动 | 每个上架插件在 Discussions 的 Announcements 分类里有一条点赞帖（正文开头是 `<!-- focusd-plugin: <id> -->`，新上架的插件由这个工作流自动开帖）；统计每条帖子的 👍，写进 `stars.json`。岛屿插件市场显示这个数字，卡片上的点赞按钮打开对应的帖子。和 `Update index` 排同一个队，不会同时推送 |

- 已上架的版本不会重新下载，也不会改变。
- 新版本申请更多权限、加入 webview 页面或换了运行时，不会自动上架，而是开一个 `review-needed` issue；维护者审核后在 `plugins/<id>.json` 写 `"approved": "<版本>"`。
- 官方插件（发布者 `TixXin`）可以用 `"package"` 指定固定的下载地址，地址是 `raw.githubusercontent.com` 上的 `<id>-<版本>.zip`、又写了 `path` 时，每次构建都读 `path` 里的清单：源码的版本比地址里的新，就改用同一文件夹里那个版本的 zip（`scripts/lib/official.mjs`），不用再手动改地址。岛屿仓库只有打好包、签好名（`pnpm plugins:index`）的版本才能进 `main`；跟过来的版本仍要通过作者签名，要的权限比上一版多时和普通发布一样等待审核（`approved`）。作者签名取地址加 `.sig`（`pnpm plugins:index` 一起写出），用官方作者密钥 `0c663505c8e1d524` 签名。
- 已验证发布者：每次构建检查 GitHub 组织的 `is_verified`，或提交里 `domain` 的 `https://<domain>/.well-known/focusd-publisher.json`；通过时条目带 `"verified": { "via": "github" }` 或 `{ "via": "domain", "domain": "..." }`，检查失败（网络问题）时保留原状态。官方发布者不检查。
- 提交写了 `signingKeys` 的插件只收录作者签了名的版本（Release 里的 `<zip>.sig`），签名和作者公钥写进索引条目的 `authorSignature`、`authorKeys`，由岛屿校验。见 [CONTRIBUTING.md](CONTRIBUTING.md#作者签名)。
- 市场详情里的说明和版本历史取自插件包里的 `README.md` / `CHANGELOG.md`，包里没有时取插件仓库 Release 标签处（官方插件为默认分支）`path` 文件夹里的同名文件。
- 切换到本仓库之前发布的岛屿仍然读岛屿仓库 `plugins/index.json`（旧密钥签名，只含官方插件），那份索引在岛屿仓库里继续维护。0.3.8-beta.4 之后发布的岛屿只信任 CI 密钥 `e862885af5bba3dc`，`keys/trusted.json` 里也只有它。
- 推 `main` 的四个工作流（索引、点赞、主题、`Publish v3`）都用 `ci-push` 环境里的部署密钥（secret `CI_PUSH_DEPLOY_KEY`，环境只允许 `main`）：仓库在个人账户下，GitHub 不允许让 GitHub Actions 绕过规则集，部署密钥可以。`main` 的规则集要求经 PR 合入、一个批准（新推送会撤销旧批准）、`check` 和 `v3-report` 两个检查通过；部署密钥总能绕过，管理员只能在 PR 上绕过。部署密钥推的提交会触发别的工作流（`GITHUB_TOKEN` 推的不会），所以 `index.json` 一变 `Update likes` 就会跑一次。

## 维护者

- 签名私钥只存在 `release` 环境的 secret `FOCUSD_PLUGIN_SIGNING_KEY` 里，该环境只允许 `main` 分支使用。
- 换密钥：先在岛屿的 `plugins/signing-keys.json` 加入新公钥并发布岛屿新版本，再更新这里的 `keys/trusted.json` 和 secret。
- 下架：在 `revoked.json` 加一项 `{ "id", "versions": "*" | ["1.2.0"], "reason": { "zh-CN", "en" }, "action": "disable" | "uninstall" }`，合并后 CI 会重新签名。
- 第 3 版索引密钥只在 `release` 环境的 secret `FUYU_INDEX_V3_SIGNING_KEY` 里，公钥在 `keys/trusted.v3.json` 的 `index`；它签不了撤销名单。撤销密钥离线，只在维护者自己的电脑上，公钥在 `revocation`。两组都要先进岛屿（`TixXin/fuyu` 的信任根）再进这里。
- 第 3 版的紧急版本：维护者在那个版本行加 `"urgent": { "reason": { "zh-CN", "en" } }`，岛屿不等 3 天冷静期。只有维护者能删版本、删作者密钥、标 `urgent`。第 3 版的检查把仓库的所有者、组织成员和协作者都当维护者（`author_association`）。
- 协作者：有 Write 权限，能批准别人的 PR，自己的 PR 要别人批，只有绿档的例行更新由 `Approve routine v3 updates` 自动批准。
- 信任作者：`market/v3/trusted-authors.json` 的 `authors`（小写的 GitHub 用户名，只由维护者改），还得是协作者。他们自己作用域的插件，检查通过就自动批准，包括首次上架和黄档，维护者不再读源码；用户的安全就靠对这个人的信任，只给真正信得过的人加。仓库设置里要打开「Allow GitHub Actions to create and approve pull requests」。
- 本地检查：`npm ci && npm run tools -- --install && npm test && node scripts/sign.mjs --check`。`npm run tools` 把 `market/v3/tools.json` 钉的 `TixXin/fuyu` 提交稀疏检出到 `.tools/fuyu`；要换工具版本就改那个提交号。

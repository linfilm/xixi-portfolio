# vendor/

第三方运行时依赖，本地托管，避免页面运行时依赖公共 CDN。

## vgpu.js

- 包：`vgpu@0.6.0`（https://github.com/vercel-labs/vgpu）
- 许可：MIT
- 来源：`https://esm.sh/vgpu@0.6.0/es2022/vgpu.bundle.mjs`（esm.sh 打包为单文件 ESM，已内联其依赖，无外部 import）
- 用途：Hero 背景 `hero/aero-shards.js` 所需的 WebGPU 运行时（设备/画布/渲染目标/管线封装）

更新方式：换掉同名文件即可，API 以 `vgpu` 对应版本的导出的 `init / surface / target / draw / effect / frame / uniforms / storage / sampler` 为准。

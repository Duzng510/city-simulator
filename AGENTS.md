# AGENTS.md

City walk sim (React 19 + Three.js 0.187 + Vite 8 + Tailwind v4): thành phố đi bộ thời gian thực,
không điểm số, không nhiệm vụ. Machine đọc code được thì tài liệu này chỉ ghi thứ **không** suy ra
được từ code — giữ ngắn, sửa lại khi quy tắc đổi.

## Lệnh

| Lệnh | Dùng |
|---|---|
| `npm run dev` | dev server (verify bắt buộc chạy qua localhost) |
| `npx tsc --noEmit` | **check duy nhất** |
| `node tools/shot.mjs [<out.png>]` | screenshot + console log qua CDP (thiếu path → `.verify/shot.png`) |

**Không `npm run build`, không sinh `dist/`** . Máy dev i5-13420H +
Intel UHD: build chỉ để tốn thời gian, type-check là đủ.

## Kiến trúc: engine là nguồn sự thật, React chỉ là HUD

- `src/engine/engine.ts` (~220 dòng) — **composition root**: dựng từng system theo thứ tự phụ thuộc,
  đọc URL, nối `api` sang React (`setTier/setTime/setRain/cam/capture/hud/project/dispose`…). Không còn
  loop hay logic render ở đây — thêm system mới là thêm một `make*()` + một dòng trong `hooks`/`api`.
- Vòng lặp thật: `runtime.ts` (`makeRuntime().start()`) — mọi logic mỗi frame nằm trong `frame()` của nó.
  Contract dữ liệu chung ở `types.ts` (`Sim` blackboard, `Stats`, `Tier`, `Mode`).
- System module, mỗi cái một trách nhiệm: `quality.ts` post-processing + tier, `timeline.ts` trời/đêm + env,
  `camera.ts` rig đi bộ/ngồi + `hud()`/`project()`, `input.ts` phím chuột touch, `interaction.ts` tương tác E,
  `vehicle.ts` B1 lái xe + đạp, `audioRuntime.ts` nối tiếng với sim, `capture.ts` capture một lần cho gallery
  + harness, `scene.ts` dressing, `reflect.ts` SSR, `world.ts` ghép `city`+`entities`+`player`+`props`.
- Module nội dung (mới là thứ **phải đọc theo vùng**): `city.ts` layout + mọi vị trí tương tác,
  `entities.ts` (~990 dòng) xe/ped, `wildlife.ts` chim/đom đóm/bồ câu/mèo (stream rng riêng, `meow` là
  callback đưa vào), `geo.ts` `paint`/`boxAt` dùng chung cho hai module trên, `player.ts` camera đi bộ +
  observe, `textures.ts`, `audio.ts` tiếng, `weather.ts` mưa, `fx.ts` steam/drips/shafts/speed lines,
  `props.ts`, `character.ts`, `util.ts` rng/clamp/lerp.
- `src/useGame.ts` nối `api` ↔ React state; `src/App.tsx` menu + panel cấu hình;
  `src/ui/hud.tsx` minimap/compass/POI/touch, đọc qua `eng().hud()` và `eng().project()`.

**Logic mỗi frame đặt trong `frame()` của engine.** Không thêm `useState`/`useEffect` polling cho thứ
chạy 60fps; React chỉ nhận `Stats` qua `onStats` (~2.5Hz) và gọi setter. Không có `public/` hay
`assets/` — texture và audio đều sinh bằng code; thêm file ảnh/mẫu âm thanh là sai hướng.

## Bẫy hay gặp

1. **Composer**: mọi pass phải được dispose — `teardownComposer()` tự đi từng pass vì
   `EffectComposer.dispose()` bỏ sót GTAO/Bloom render target. Đổi tier / FX / filter luôn đi qua
   `applyTier()` (rebuild cả chain), không mutate pass trực tiếp. `tier === 'low'` nghĩa là tắt post.
2. **Determinism**: `buildCity(tex, 20261102)`, `buildEntities(tex, 5150)`, rng tập trung ở
   `util.ts`. Layout phố/xe/ped **không** dùng `Math.random()` (ambience, timing, camera shake thì được).
   **Thứ tự gọi `rand()` là contract**: cùng seed, đổi thứ tự là đổi cả thành phố. Tách code ăn `rand`
   chung phải **dời khối liên tục**, không xen kẽ với code dùng stream khác.
3. **URL contract** `?h,rain,tier,mode,bloom,rays,fx,adaptive`: **engine là nơi duy nhất parse** (lúc init).
   `useGame` không tự đọc URL nữa — nó hydrate React state từ `api.getState()` ngay sau `createEngine()`,
   rồi ghi lại URL sau 500ms bằng `history.replaceState`. Thêm setting mới chỉ cần sửa engine (parse +
   `getState`); gọi `setEffects`/`setTime` từ state React lúc mount sẽ **xoá sạch** cấu hình URL.
   Hai lỗ hổng còn lại của contract: `adaptive` không được ghi lại, và `?mode=` luôn bị mount ép
   `observe` (menu cần thành phố chạy nền phía sau), nên URL chia sẻ không mở đúng mode.
4. **Perf**: không cấp phát trong `frame()` — tái dùng vector scratch (`camPos`, `hudFx`, `driveFx`,
   `hlTmp`, `dm4`…), không tạo material/geometry mỗi frame. Mục tiêu 60fps ở `medium`.
5. Input: pointer lock chiếm chuột — phím toàn cục (`F`, `Enter`, `Esc`) chỉ chạy khi
   `!document.pointerLockElement`; engine tự bắt `E/O/P` khi đang chơi.

## Quy ước

- Copy UI **và** comment: tiếng Việt. Comment mang ID tính năng làm anchor (`B1` lái xe, `B3` vào
  cửa hàng, `C8` steam/drips, `D3` còi cứu thương) — thêm feature thì cấp ID mới, giữ nguyên cái cũ.
  Comment chỉ ghi WHY (ràng buộc ẩn, lý do thuật toán); code tự giải thích WHAT.
- Touch: mọi branch đi qua `IS_TOUCH` (`src/ui/eng.ts`) — target ≥44px, `env(safe-area-inset-*)`.
- Style: Tailwind v4 (`@import "tailwindcss"` trong `index.css`, không file config), class string
  inline, tái dùng helper `panel` / `chip` / `btn` / `fxBtn` trong `App.tsx`.
- TS strict + `isolatedModules`: `import type` cho type-only; không `any` trừ chỗ Three.js internals
  (`Record<string, { value: any }>`).
- Không thêm dependency hay framework test nếu chưa hỏi.
- Ảnh gallery lưu localStorage `cs.shots` (tối đa 12 thumbnail, nén JPEG 320px).

## Verify bằng mắt (WebGL không render được trong in-app browser)

Drive Chrome headless qua CDP — `tools/shot.mjs` giả định Chrome mở với `--remote-debugging-port=9333`
và đang ở trang game:

```bash
npm run dev                       # localhost:5173
URL=... EXPR="window.__sim.cam(x,y,z,yaw,pitch,fov)" node tools/shot.mjs .verify/a.png
```

`window.__sim` chỉ expose trên `localhost`/`127.0.0.1`. Dùng `__sim.cam(...)` để định khung
deterministic rồi `__sim.capture(w,h)` để lấy ảnh 4K. Output phải in `console: clean`; nếu có
`EXCEPTION` thì đó là bug thật, sửa trước khi báo xong. Artifact verification để trong `.verify/`
(đã gitignore).

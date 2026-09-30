/* ── Workout story composer ─────────────────────────────────────────
 * Strava-style: the user picks a photo, the stats sticker
 * (src/js/story-sticker.js) sits on top of it, and they drag / pinch it
 * into place. From here they can:
 *   • Instagram Stories — native only. Sends the photo as the story
 *     background and the sticker as a separate, movable sticker through
 *     the InstagramStories Capacitor plugin (plugins/instagram-stories).
 *   • Save image / Share — the photo and sticker merged into one
 *     1080×1920 image, for every other app.
 *   • Save sticker only — the transparent PNG on its own.
 */
(function () {
  'use strict';

  // Meta requires an app ID on every Sharing-to-Stories call, otherwise
  // Instagram shows "The app you shared from doesn't currently support
  // sharing to Stories". It is public (it ships in every share URL).
  const FACEBOOK_APP_ID = '1059510706961005';
  const OUT_W = 1080;
  const OUT_H = 1920;
  const BG_TOP = '#0f2318';
  const BG_BOTTOM = '#060d0a';

  const state = {
    workout: null,
    photo: null,          // HTMLImageElement
    x: 0.5, y: 0.42,      // sticker centre, as a fraction of the stage
    scale: 0.8,           // sticker width, as a fraction of the stage width
  };

  const $ = (id) => document.getElementById(id);

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (_e) { return []; }
  }

  function currentUserName() {
    try { return typeof currentUser !== 'undefined' ? currentUser : window.currentUser; } catch (_e) { return window.currentUser; }
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
  }

  function isNative() {
    return !!window.Capacitor?.isNativePlatform?.();
  }

  function instagramPlugin() {
    const cap = window.Capacitor;
    if (!isNative() || !cap?.isPluginAvailable?.('InstagramStories')) return null;
    return cap.Plugins?.InstagramStories || cap.registerPlugin?.('InstagramStories') || null;
  }

  // ── Open / close ────────────────────────────────────────────────────
  function openWorkoutStoryModal(workoutIndex) {
    const user = currentUserName();
    const workouts = readJSON(`workouts_${user}`);
    const workout = workouts[workoutIndex];
    if (!workout) return;
    const history = workouts.concat(readJSON(`workoutHistory_${user}`));

    state.workout = workout;
    state.x = 0.5; state.y = 0.42; state.scale = 0.8;

    const data = window.StorySticker.buildStickerData(workout, history, window.getMuscleGroup);
    window.StorySticker.drawSticker($('wstorySticker'), data);

    $('workoutStoryModal').hidden = false;
    document.body.classList.add('wstory-open');
    layoutSticker();
    refreshInstagramButton();
  }

  function closeWorkoutStoryModal() {
    $('workoutStoryModal').hidden = true;
    document.body.classList.remove('wstory-open');
  }

  async function refreshInstagramButton() {
    const btn = $('wstoryIgBtn');
    const save = $('storyDownloadBtn');
    let ok = false;
    const plugin = instagramPlugin();
    if (plugin) {
      try { ok = !!(await plugin.isAvailable()).available; } catch (_e) { ok = false; }
    }
    btn.hidden = !ok;
    // One filled button per row: Instagram takes it when it's there.
    save.classList.toggle('mx-cta', !ok);
    save.classList.toggle('mx-outline', ok);
  }

  // ── Photo ───────────────────────────────────────────────────────────
  function setPhoto(img) {
    state.photo = img;
    const el = $('wstoryPhoto');
    if (img) { el.src = img.src; el.hidden = false; } else { el.removeAttribute('src'); el.hidden = true; }
    $('wstoryClearBtn').hidden = !img;
    $('wstoryPhotoLabel').textContent = img ? 'Change photo' : 'Add a photo';
  }

  function onFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setPhoto(img);
    img.onerror = () => toast("That photo couldn't be opened. Try another.", 'warn');
    img.src = url;
  }

  // ── Sticker placement (drag + pinch) ────────────────────────────────
  function layoutSticker() {
    const el = $('wstorySticker');
    el.style.width = `${state.scale * 100}%`;
    el.style.left = `${state.x * 100}%`;
    el.style.top = `${state.y * 100}%`;
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pointers = new Map();
  let gesture = null;

  function snapshotGesture() {
    const pts = [...pointers.values()];
    const stage = $('wstoryStage').getBoundingClientRect();
    gesture = { stage, x: state.x, y: state.y, scale: state.scale, pts: pts.map((p) => ({ ...p })) };
    if (pts.length === 2) gesture.dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
  }

  function onPointerDown(e) {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    snapshotGesture();
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    const { stage } = gesture;
    if (pts.length >= 2 && gesture.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      state.scale = clamp(gesture.scale * (d / gesture.dist), 0.3, 1.2);
    } else {
      const p0 = gesture.pts[0];
      state.x = clamp(gesture.x + (pts[0].x - p0.x) / stage.width, 0.05, 0.95);
      state.y = clamp(gesture.y + (pts[0].y - p0.y) / stage.height, 0.05, 0.95);
    }
    layoutSticker();
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size) snapshotGesture(); else gesture = null;
  }

  function onWheel(e) {
    e.preventDefault();
    state.scale = clamp(state.scale * (e.deltaY < 0 ? 1.06 : 0.94), 0.3, 1.2);
    layoutSticker();
  }

  // ── Export ──────────────────────────────────────────────────────────
  function fillBackground(ctx, w, h) {
    if (state.photo) {
      const img = state.photo;
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, BG_TOP);
      g.addColorStop(1, BG_BOTTOM);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function composeStory() {
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    fillBackground(ctx, OUT_W, OUT_H);
    const sticker = $('wstorySticker');
    const sw = state.scale * OUT_W;
    const sh = sw * (sticker.height / sticker.width);
    ctx.drawImage(sticker, state.x * OUT_W - sw / 2, state.y * OUT_H - sh / 2, sw, sh);
    return canvas;
  }

  function photoOnly() {
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    fillBackground(canvas.getContext('2d'), OUT_W, OUT_H);
    return canvas;
  }

  const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
  const base64 = (canvas, type, q) => canvas.toDataURL(type, q).split(',')[1];

  function fileName(suffix) {
    return `pocket-coach-${state.workout?.date || 'workout'}${suffix}`;
  }

  function download(canvas, name) {
    const link = document.createElement('a');
    link.download = name;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  // navigator.share with a file; resolves false when the platform can't.
  async function shareFile(canvas, name, type) {
    if (!navigator.share || !navigator.canShare) return false;
    const blob = await toBlob(canvas, type, 0.92);
    const file = new File([blob], name, { type });
    if (!navigator.canShare({ files: [file] })) return false;
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e && e.name === 'AbortError') return true;
      throw e;
    }
    return true;
  }

  async function onSave() {
    const canvas = composeStory();
    // WebViews ignore <a download>; the share sheet has "Save Image".
    if (isNative()) {
      try { if (await shareFile(canvas, fileName('.jpg'), 'image/jpeg')) return; } catch (_e) { /* fall through */ }
    }
    download(canvas, fileName('.png'));
  }

  async function onShare() {
    const canvas = composeStory();
    try {
      if (await shareFile(canvas, fileName('.jpg'), 'image/jpeg')) return;
      if (navigator.clipboard?.write && window.ClipboardItem) {
        const blob = await toBlob(canvas, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Image copied', 'success');
        return;
      }
      download(canvas, fileName('.png'));
    } catch (e) {
      console.warn('[story] share failed', e);
      toast('Sharing didn\'t work. Use Save image instead.', 'warn');
    }
  }

  async function onSaveSticker() {
    const sticker = $('wstorySticker');
    if (isNative()) {
      try { if (await shareFile(sticker, fileName('-sticker.png'), 'image/png')) return; } catch (_e) { /* fall through */ }
    }
    download(sticker, fileName('-sticker.png'));
  }

  async function onInstagram() {
    const plugin = instagramPlugin();
    if (!plugin) return;
    const btn = $('wstoryIgBtn');
    btn.disabled = true;
    try {
      const opts = {
        appId: FACEBOOK_APP_ID,
        stickerImage: base64($('wstorySticker'), 'image/png'),
        backgroundTopColor: BG_TOP,
        backgroundBottomColor: BG_BOTTOM,
      };
      if (state.photo) opts.backgroundImage = base64(photoOnly(), 'image/jpeg', 0.9);
      await plugin.share(opts);
    } catch (e) {
      console.warn('[story] Instagram share failed', e);
      toast('Couldn\'t open Instagram. Use Save image instead.', 'warn');
    } finally {
      btn.disabled = false;
    }
  }

  // ── Wire up ─────────────────────────────────────────────────────────
  function init() {
    const modal = $('workoutStoryModal');
    if (!modal) return;
    const sticker = $('wstorySticker');
    sticker.addEventListener('pointerdown', onPointerDown);
    sticker.addEventListener('pointermove', onPointerMove);
    sticker.addEventListener('pointerup', onPointerUp);
    sticker.addEventListener('pointercancel', onPointerUp);
    $('wstoryStage').addEventListener('wheel', onWheel, { passive: false });

    $('wstoryPhotoBtn').addEventListener('click', () => $('wstoryFile').click());
    $('wstoryFile').addEventListener('change', onFileChosen);
    $('wstoryClearBtn').addEventListener('click', () => setPhoto(null));
    $('wstoryIgBtn').addEventListener('click', onInstagram);
    $('storyDownloadBtn').addEventListener('click', onSave);
    $('storyShareBtn').addEventListener('click', onShare);
    $('wstoryStickerOnly').addEventListener('click', onSaveSticker);
    $('wstoryCloseBtn').addEventListener('click', closeWorkoutStoryModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeWorkoutStoryModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) closeWorkoutStoryModal();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.openWorkoutStoryModal = openWorkoutStoryModal;
  window.closeWorkoutStoryModal = closeWorkoutStoryModal;
})();

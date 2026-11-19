import { TableNotice } from './TableNotice';
import { JobResultActions, needsServiceReview, serviceReviewHeading } from './JobResultActions';
import { existingServiceResult } from '@goltou/core/job-safety';
import { JobLogs, JobLogFailure } from './JobLogs';
import { formattingMessage } from './formatting-message';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type {
  Mode,
  Page,
  Post,
  PostInput,
  Product,
  ProductSummary,
  Settings,
} from '@goltou/api-client';
import { defaultMyText } from '@goltou/api-client';
import type { Commands, JobInput, Service } from '@goltou/core/protocol';
import type { PreparedPreview } from '@goltou/core';
import { fillMyText, productTags } from '@goltou/core/post-extras';
import { deletedPost } from '@goltou/core/post-delete-policy';
import { clearError, experiment, request, useStore } from './store';
import { PostingTags, PreviousPublication, ProductListItem, ProductMeta, ProductPostHistory } from './ProductPosting';
import { MyTextSettings, TextSwitch, UnbrokenPhone } from './MyTextSettings';
import { TodayStatus } from './TodayStatus';
import { PublishResult, isPublishResult } from './PostingTargets';
import { BrandMark } from './BrandMark';
import { ConversionPreview, sourcePhotoRatios } from './ConversionPreview';
import { LoginStatus, type LoginService } from './ServiceLogin';
import { initialPreviewOptions } from './polish-setting';
import { PolishStrengthChoice } from './PolishStrengthChoice';
import { PolishComparison } from './PolishComparison';
import { PostDeleteAction } from './PostDeleteAction';
import { Sheet } from './Sheet';
import { UpdateNotice, UpdateSettings, UpdateSheet } from './AppUpdate';
import { LiveProgress } from './LiveProgress';
import { jobMessage } from './job-message';
import { bandListFailureHint } from './band-list-failure';
import { BandChooser } from './BandChooser';
import { BandListStatus } from './BandListStatus';
import {
  targetStatus,
  targetName,
  resultKind,
  historyLine,
  uncertainReason,
  canRetryHistory,
  bandPostBlocked,
} from './ux-state';
const Experiments = __GOLTOU_DEBUG__
  ? lazy(() =>
      import('./Experiments').then((m) => ({ default: m.ExperimentsScreen })),
    )
  : () => null;
type Screen =
  | 'login'
  | 'home'
  | 'preview'
  | 'polish'
  | 'progress'
  | 'connect'
  | 'service'
  | 'history'
  | 'logs'
  | 'settings'
  | 'experiments';
type SheetName =
  | 'draft'
  | 'publish'
  | 'confirm'
  | 'stop'
  | 'dialog'
  | 'leave'
  | 'exit'
  | null;
type Band = import('@goltou/sites').BandChoice;
const ignore = () => {};
const recordTime = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '시간 확인 필요';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export function Toggle({
  label,
  value,
  change,
  disabled,
}: {
  label: string;
  value: boolean;
  change(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <button
      className="switch"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      onClick={() => change(!value)}
    >
      <span />
    </button>
  );
}
export function App() {
  const { snapshot: app, connected, error, debug } = useStore();
  const [screen, setScreen] = useState<Screen>('login'),
    [sheet, setSheet] = useState<SheetName>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [blocked, setBlocked] = useState(false);
  const [loginId, setLoginId] = useState(''),
    [password, setPassword] = useState('');
  const [products, setProducts] = useState<Page<ProductSummary>>({
      items: [],
      total: 0,
    }),
    [q, setQ] = useState(''),
    [unposted, setUnposted] = useState(false),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false),
    [loadFailed, setLoadFailed] = useState(false);
  const [product, setProduct] = useState<Product | null>(null),
    [converted, setConverted] = useState<PreparedPreview | null>(null),
    [preparing, setPreparing] = useState(false),
    [preview, setPreview] = useState<'blog' | 'band'>('blog');
  const [options, setOptions] = useState(initialPreviewOptions),
    [previewRefresh, setPreviewRefresh] = useState(0);
  const previewQueue = useRef(Promise.resolve());
  const [preferencesReady, setPreferencesReady] = useState(false);
  const settingsReturn = useRef<Screen>('home');
  const preferencesWrites = useRef(Promise.resolve());
  const [mode, setMode] = useState<Mode>('draft'),
    [blog, setBlog] = useState(true),
    [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [bands, setBands] = useState<Band[]>([]),
    [bandKeys, setBandKeys] = useState<string[]>([]),
    [lastBandKeys, setLastBandKeys] = useState<string[]>([]),
    [preselectedBands, setPreselectedBands] = useState(false),
    [loadingBands, setLoadingBands] = useState(false),
    [bandsFailed, setBandsFailed] = useState(false),
    [bandsFailureReason, setBandsFailureReason] = useState('');
  const bandSelectionTouched = useRef(false);
  const chosenBands = bandKeys.flatMap(key => bands.filter(band => band.key === key));
  const band = app?.services.band === 'confirmed' && chosenBands.length > 0;
  const [dailyUsage, setDailyUsage] = useState<Commands['bands.dailyUsage']['output']>();
  const [bandsSavedAt, setBandsSavedAt] = useState<number | null>(null);
  const [refreshingBands, setRefreshingBands] = useState(false);
  const bandsRevision = useRef(0);
  const [service, setService] = useState<LoginService>('naver'),
    [loginOpened, setLoginOpened] = useState(false),
    [returnScreen, setReturnScreen] = useState<Screen>('connect'),
    [returnSheet, setReturnSheet] = useState<SheetName>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine'),
    [posts, setPosts] = useState<Page<Commands['posts.list']['output']['items'][number]>>({ items: [], total: 0 }),
    [postPage, setPostPage] = useState(1),
    [postRefresh, setPostRefresh] = useState(0);
  const [settings, setSettings] = useState<Settings>({
    closingText: '',
    defaultHashtags: [],
    bandDailyLimit: 3,
  });
  const [tagWordsInput, setTagWordsInput] = useState('');
  const [loginSubmitted, setLoginSubmitted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingMyText, setEditingMyText] = useState(false);
  const [exitHint, setExitHint] = useState(false);
  const exitDeadline = useRef(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pendingNavigation, setPendingNavigation] = useState<Screen>('home');
  const [settingsAttempted, setSettingsAttempted] = useState(false);
  const dirtySettings =
    !!app?.settings &&
    JSON.stringify(settings) !== JSON.stringify(app.settings);
  const invalidLimit =
    !Number.isInteger(settings.bandDailyLimit) ||
    settings.bandDailyLimit < 1 ||
    settings.bandDailyLimit > 10;
  const job = app?.job;
  const active =
    !!job &&
    (job.status === 'record_failed' || !job.completedSteps.includes(7) &&
      !['draft_saved', 'draft_unverified', 'published', 'stopped'].includes(job.status));
  function clearExitHint() {
    clearTimeout(exitTimer.current);
    exitDeadline.current = 0;
    setExitHint(false);
  }
  function go(next: Screen, replace = false, discard = false) {
    if (
      screen === 'settings' &&
      next !== 'settings' &&
      dirtySettings &&
      !discard
    ) {
      setPendingNavigation(next);
      setSheet('leave');
      return;
    }
    if (next === 'settings')
      settingsReturn.current = screen === 'preview' ? 'preview' : 'home';
    clearExitHint();
    clearError();
    setNotice('');
    setSheet(null);
    setScreen(next);
    history[replace ? 'replaceState' : 'pushState'](
      { screen: next },
      '',
      location.pathname,
    );
    // A closing sheet restores its previous reading position during cleanup.
    // Screen navigation must reset after that cleanup, including discarded settings.
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    clearError();
    try {
      await fn();
    } catch {
      /* Sanitized store error. */
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const pop = (event: Event) => {
      event.preventDefault();
      if (document.querySelector('.sheet')) {
        window.dispatchEvent(new Event('goltou:close-sheet'));
        return;
      }
      if (screen === 'home') {
        if (Date.now() < exitDeadline.current) {
          clearExitHint();
          setSheet('exit');
          void request('app.exit', { event: 'confirm' }, true).catch(ignore);
        } else {
          clearExitHint();
          exitDeadline.current = Date.now() + 2000;
          setExitHint(true);
          exitTimer.current = setTimeout(clearExitHint, 2000);
          void request('app.exit', { event: 'hint' }, true).catch(ignore);
        }
        return;
      }
      if (active && screen !== 'service') {
        setScreen('progress');
        setSheet('stop');
        return;
      }
      if (screen === 'service') {
        void request('service.hide', {}).catch(ignore);
        go(returnScreen, true);
        return;
      }
      go(
        screen === 'settings'
          ? settingsReturn.current
          : app?.user
            ? 'home'
            : 'login',
        true,
      );
    };
    window.addEventListener('goltou:back', pop);
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('goltou:back', pop);
    };
  }, [
    active,
    screen,
    sheet,
    returnScreen,
    !!app?.user,
    !!product,
    dirtySettings,
  ]);
  useEffect(() => () => clearTimeout(exitTimer.current), []);
  useEffect(() => {
    if (app?.user && screen === 'login') go(active ? 'progress' : 'home', true);
    if (app && !app.user) {
      setScreen('login');
      setProduct(null);
      setConverted(null);
      setLoginId('');
      setPassword('');
      setPosts({ items: [], total: 0 });
      setProducts({ items: [], total: 0 });
    }
  }, [app?.user?.userNo]);
  useEffect(() => {
    if (app?.user && screen === 'home') void request('update.home', {}).catch(ignore);
  }, [app?.user?.userNo, screen]);
  useEffect(() => {
    if (app?.settings) {
      setSettings(app.settings);
      setTagWordsInput(app.settings.defaultHashtags.join(', '));
    }
  }, [JSON.stringify(app?.settings)]);
  useEffect(() => {
    const scrollField = () => {
      const field = document.activeElement;
      if (
        screen !== 'settings' ||
        !(
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement
        )
      )
        return;
      (field.closest('label') ?? field).scrollIntoView({
        block: 'center',
        behavior: 'auto',
      });
    };
    const focus = () => {
      const field = document.activeElement;
      setEditing(
        screen === 'settings' &&
          (field instanceof HTMLInputElement ||
            field instanceof HTMLTextAreaElement),
      );
      setEditingMyText(screen === 'settings' && !!field?.closest('.my-text-settings') && field instanceof HTMLTextAreaElement);
      setTimeout(scrollField, 80);
      setTimeout(scrollField, 300);
    };
    const resize = () => {
      requestAnimationFrame(scrollField);
    };
    const keyboard = (event: Event) => {
      const visible = (event as CustomEvent<{ visible?: boolean }>).detail?.visible;
      if (typeof visible === 'boolean') {
        const field = document.activeElement;
        setEditing(visible && screen === 'settings' &&
          (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement));
        setEditingMyText(visible && screen === 'settings' && !!field?.closest('.my-text-settings') && field instanceof HTMLTextAreaElement);
        if (!visible) return;
      }
      resize();
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', focus);
    window.addEventListener('resize', resize);
    window.addEventListener('goltou:keyboard', keyboard);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', focus);
      window.removeEventListener('resize', resize);
      window.removeEventListener('goltou:keyboard', keyboard);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [screen]);
  useEffect(() => {
    setOptions(old => ({ ...old, closing: app?.myText?.closingOn ?? true }));
  }, [app?.user?.userNo, app?.myText?.closingOn]);
  useEffect(() => {
    if (connected)
      void request('preferences.get', {})
        .then((value) => {
          setLastBandKeys(value.lastBandKeys);
          if (!bandSelectionTouched.current) {
            setBandKeys(value.lastBandKeys);
            setPreselectedBands(value.lastBandKeys.length > 0);
          }
          setOptions((old) => ({
            ...old,
            polish: value.polish,
            linkCard: value.linkCard,
          }));
          setPreferencesReady(true);
        })
        .catch(ignore);
  }, [connected]);
  useEffect(() => {
    if (!preferencesReady) return;
    const value = {
      polish: options.polish,
      closing: false,
      linkCard: options.linkCard,
      lastBandKeys,
    };
    preferencesWrites.current = preferencesWrites.current
      .catch(ignore)
      .then(async () => {
        await request('preferences.save', value);
      })
      .catch(ignore);
  }, [
    preferencesReady,
    options.polish,
    options.linkCard,
    lastBandKeys,
  ]);
  useEffect(() => {
    if (connected)
      void request('polish.setting.get', {})
        .then((polishStrength) =>
          setOptions((old) => ({ ...old, polishStrength })),
        )
        .catch(ignore);
  }, [connected]);
  useEffect(() => {
    if (screen !== 'home' || !app?.user) return;
    let live = true;
    setLoading(true);
    setLoadFailed(false);
    let timer: ReturnType<typeof setTimeout>;
    const load = async (retry: boolean) => {
      try {
        const data = await request('products.list', { q, onlyUnposted: unposted, page, pageSize: 10 }, true);
        if (!live) return;
        setProducts(old => ({ ...data, items: page === 1 ? data.items : [...old.items, ...data.items] }));
        setLoading(false);
      } catch {
        if (!live) return;
        if (!retry && page === 1) {
          timer = setTimeout(() => void load(true), 350);
          return;
        }
        setLoadFailed(true);
        setLoading(false);
      }
    };
    timer = setTimeout(() => void load(false), 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [screen, app?.user?.userNo, q, unposted, page, refresh]);
  const choosingPublish = sheet === 'publish' || sheet === 'confirm';
  const needsPreview = screen === 'preview' || choosingPublish;
  useEffect(() => {
    if (!product || !needsPreview || active) return;
    let live = true;
    setPreparing(true);
    previewQueue.current = previewQueue.current.then(async () => {
      if (!live) return;
      try {
        const data = await request('preview.prepare', { productNo: product.productNo, options });
        if (live) setConverted(data);
      } catch {
        if (live) setConverted(null);
      } finally {
        if (live) setPreparing(false);
      }
    });
    return () => {
      live = false;
    };
  }, [needsPreview, product, options, previewRefresh, active, app?.myText?.prefix, app?.myText?.closing]);
  useEffect(() => {
    if (screen === 'progress' && job && !converted)
      void request('job.preview', {}).then(setConverted).catch(ignore);
  }, [screen, job?.id, !!converted]);
  useEffect(() => {
    if (screen !== 'history' || !app?.user) return;
    let live = true;
    setLoading(true);
    setLoadFailed(false);
    void request('posts.list', { scope, page: postPage, pageSize: 20 })
      .then((data) => {
        if (live)
          setPosts((old) => ({
            ...data,
            items: postPage === 1 ? data.items : [...old.items, ...data.items],
          }));
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [screen, scope, postPage, postRefresh, app?.user?.userNo]);
  function receiveBands(result: Commands['bands.list']['output']) {
    if (!Array.isArray(result) && result.revision !== undefined) {
      if (result.revision < bandsRevision.current) return;
      bandsRevision.current = result.revision;
    }
    const rows = Array.isArray(result) ? result : result.rows;
    setBands(rows);
    if (!Array.isArray(result)) {
      setBandsSavedAt(result.savedAt);
      setRefreshingBands(result.refreshing === true);
      setBandsFailed(!!result.failure);
      setBandsFailureReason(result.failure ?? '');
    }
    if (Array.isArray(result) || !result.failure && !result.refreshing && (result.source === 'band' || result.savedAt !== null)) {
      const keepAvailable = (old: string[]) => {
        const keys = old.filter(key => rows.some(band => band.key === key));
        return keys.length === old.length ? old : keys;
      };
      setBandKeys(keepAvailable);
      setLastBandKeys(keepAvailable);
    }
  }
  useEffect(() => { if (app?.bandList) receiveBands(app.bandList); }, [app?.bandList]);
  async function loadBands(refresh = false) {
    setLoadingBands(true);
    setBandsFailed(false);
    setBandsFailureReason('');
    try {
      receiveBands(await request('bands.list', { refresh }));
    } catch (error) {
      clearError();
      setBandsFailureReason(error instanceof Error ? error.message : '');
      setBandsFailed(true);
    } finally {
      setLoadingBands(false);
    }
  }
  useEffect(() => {
    if (job?.status === 'dialog_paused' && job.dialog) setSheet('dialog');
  }, [job?.dialog?.id]);
  const needsBands = choosingPublish || (screen === 'preview' && preview === 'band');
  useEffect(() => {
    if (needsBands && app?.services.band === 'confirmed') void loadBands();
  }, [needsBands, app?.services.band]);
  useEffect(() => {
    if (!choosingPublish || app?.services.band !== 'confirmed') return;
    let live = true;
    setDailyUsage(undefined);
    void request('bands.dailyUsage', {}, true).then(value => {
      if (live) setDailyUsage(value ?? null);
    }).catch(() => { if (live) setDailyUsage(null); });
    return () => { live = false; };
  }, [choosingPublish, app?.services.band]);
  useEffect(() => {
    if (
      screen === 'service' &&
      loginOpened &&
      app?.services[service] === 'confirmed' &&
      !app.visibleService
    ) {
      setLoginOpened(false);
      go(returnScreen, true);
      setSheet(returnSheet);
      if (returnScreen === 'progress' && job?.status === 'login_paused')
        void act(async () => {
          await request('job.resume', {});
        });
    }
  }, [screen, loginOpened, app?.services[service], app?.visibleService]);
  function openPublish() {
    setOptions(old => ({ ...old, closing: app?.myText?.closingOn ?? true }));
    setMode('publish');
    setBlog(true);
    setVisibility('public');
    setDailyUsage(undefined);
    bandSelectionTouched.current = false;
    setBandKeys(lastBandKeys);
    setPreselectedBands(lastBandKeys.length > 0);
    setSheet('publish');
  }
  async function choose(no: number, publish = false) {
    await act(async () => {
      const data = await request('products.get', { productNo: no });
      setProduct(data);
      setConverted(null);
      setPreview('blog');
      setBlog(true);
      setVisibility('public');
      setMode('draft');
      if (publish) {
        clearExitHint();
        openPublish();
      } else go('preview');
    });
  }
  function login(service: LoginService, to = screen, toSheet = sheet) {
    setService(service);
    setReturnScreen(to);
    setReturnSheet(toSheet);
    setLoginOpened(true);
    go('service');
    void act(async () => {
      await request('service.show', { service });
    });
  }
  function targets(): JobInput['targets'] {
    return [
      ...(blog || mode === 'draft'
        ? [{ channel: 'blog' as const, key: 'overseas', name: '해외골프' }]
        : []),
      ...(mode === 'publish' && band
        ? chosenBands.map(({ key, name }) => ({ channel: 'band' as const, key, name }))
        : []),
    ];
  }
  async function start(approved = false) {
    if (!approved && options.polish && converted?.polish) {
      go('polish');
      return;
    }
    if (!product || !converted) return;
    if ((mode === 'draft' || blog) && app?.services.naver !== 'confirmed') {
      login('naver', screen, sheet);
      return;
    }
    await act(async () => {
      try {
        await request('job.start', {
          productNo: product.productNo,
          mode,
          blogVisibility: visibility,
          targets: targets(),
          options,
          publishConfirmed: mode === 'publish',
          previewHash: converted.contentHash,
        });
      } catch (failure) {
        if (failure instanceof Error && /바뀌|변경|수정/.test(failure.message)) {
          if (screen === 'home') setScreen('preview');
          setSheet(null);
        }
        throw failure;
      }
      if (mode === 'publish' && band) setLastBandKeys(chosenBands.map(item => item.key));
      go('progress');
    });
  }
  function nav(selected: Screen) {
    if (selected === 'settings' && editing) return null;
    return (
      <nav className="bottom-nav" aria-label="아래 탭">
        {(
          [
            ['home', '상품'],
            ['history', '등록 기록'],
            ['settings', '설정'],
          ] as const
        ).map(([key, label]) => (
          <button
            className={selected === key ? 'selected' : ''}
            key={key}
            onClick={() => {
              setPage(1);
              setPostPage(1);
              go(key);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    );
  }
  const back = (to: Screen = 'home') => (
    <button className="back" onClick={() => go(to)}>
      ← {to === 'home' && screen === 'preview' ? '상품 목록' : '돌아가기'}
    </button>
  );
  const header = (title: React.ReactNode, home = false) => (
    <header>
      <div className="brand-row">
        <span className="brand">
          <BrandMark />
          골투오토
        </span>
        {home && <span>{app?.user?.nickname || app?.user?.name} 님</span>}
      </div>
      <h1>{title}</h1>
    </header>
  );
  const connection = (s: LoginService) => (
    <button
      className={`chip ${app?.services[s] === 'expired' ? 'need' : ''}`}
      onClick={() => go('connect')}
    >
      {s === 'naver' ? '블로그' : '밴드'}{' '}
      <LoginStatus state={app?.services[s] ?? 'checking'} />
    </button>
  );
  const serviceRow = (s: LoginService) => (
    <div className="choice-row" key={s}>
      <span>
        네이버 {s === 'naver' ? '블로그' : '밴드'}
        <small>
          <LoginStatus state={app?.services[s] ?? 'checking'} />
          {app?.services[s] === 'checking' && (
            <span> · 보통 5초 안에 끝납니다</span>
          )}
          {app?.services[s] === 'unknown' && (
            <span> · 인터넷 연결을 확인해 주세요</span>
          )}
        </small>
      </span>
      <div>
        {app?.services[s] === 'confirmed' ? (
          <button
            className="green"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await request('service.clear', { service: s });
              })
            }
          >
            연결 끊기
          </button>
        ) : app?.services[s] === 'expired' ? (
          <button
            className="green"
            disabled={busy}
            onClick={() => login(s, 'connect', null)}
          >
            로그인
          </button>
        ) : null}
        {app?.services[s] !== 'checking' && (
          <button
            className="small"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await request('service.check', { service: s });
              })
            }
          >
            다시 확인
          </button>
        )}
      </div>
    </div>
  );
  const resultRows = (
    <div className="result-rows">
      {job?.targetResults?.map((t) => (
        <div key={`${t.channel}:${t.key}`}>
          <span>
            {targetName(job, t)}
            <small className={t.status === 'published' ? 'green' : ''}>
              {targetStatus(job, t)}
            </small>
          </span>
          {t.status === 'published' && t.postUrl ? (
            <button
              className="green"
              onClick={() =>
                void act(async () => {
                  await request('post.open', { url: t.postUrl! });
                })
              }
            >
              글 보기
            </button>
          ) : t.status === 'draft_saved' ? (
            <small>공개되지 않음</small>
          ) : null}
        </div>
      ))}
    </div>
  );
  function closeExit() {
    setSheet(null);
    void request('app.exit', { event: 'cancel' }, true).catch(ignore);
  }
  const sheetClose = () => {
    if (sheet === 'exit') closeExit();
    else if (sheet === 'confirm') setSheet('publish');
    else {
      if (sheet === 'publish') setOptions(old => ({ ...old, closing: app?.myText?.closingOn ?? true }));
      setSheet(null);
    }
  };
  const bandLimit = dailyUsage?.limit ?? app?.settings?.bandDailyLimit;
  const bandsUsed = dailyUsage?.used ?? 0;
  const limitWarning = band && bandLimit && chosenBands.length + bandsUsed > bandLimit
    ? dailyUsage
      ? `밴드 하루 한도 ${bandLimit}건 중 오늘 ${bandsUsed}건을 썼습니다. ${chosenBands.length}곳을 고르면 한도를 넘습니다.`
      : `밴드 하루 한도는 ${bandLimit}건입니다. ${chosenBands.length}곳을 고르면 한도를 넘습니다.`
    : '';
  const startReason =
    (active ? '진행 중인 작업을 먼저 마쳐 주세요.'
      : mode === 'publish' && !targets().length ? '올릴 곳을 선택해 주세요.'
      : mode === 'publish' && limitWarning ? limitWarning
      : mode === 'publish' && band && dailyUsage === undefined ? '밴드 하루 한도를 확인하고 있습니다.'
      : preparing ? '미리보기를 준비하고 있습니다.'
      : !converted ? '미리보기를 불러오지 못했습니다.'
      : !targets().every((t) => converted.verification[t.channel].matches)
        ? '원문과 다른 내용이 있어 옮길 수 없습니다.'
        : busy
          ? '요청을 마치는 중입니다.'
          : '');
  const canStart =
    !!converted && !preparing && !busy && targets().length > 0 && !startReason;
  async function saveSettings() {
    setSettingsAttempted(true);
    if (invalidLimit) return false;
    await request('settings.save', settings);
    setNotice('공통 설정을 저장했습니다.');
    return true;
  }
  return (
    <div className={`app screen-${screen}${editing ? ' editing' : ''}`}>
      <div className="app-body">
        {(screen === 'connect' || screen === 'service') &&
          (error || app?.serviceError) && (
            <div className="error" role="alert">
              {/[A-Z_]{4,}/.test(error || app?.serviceError || '')
                ? '요청을 마치지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'
                : error || app?.serviceError}
              <button aria-label="오류 닫기" onClick={clearError}>
                닫기
              </button>
            </div>
          )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {screen === 'login' && (
          <>
            {header(
              <>
                골투 계정으로
                <br />
                로그인하세요
              </>,
            )}
            <main className="pad">
              <p className="meta">골투 매니저와 직원만 사용할 수 있습니다.</p>
              {blocked && (
                <p role="alert">
                  매니저와 직원 전용입니다. 계정 등급을 확인해 주세요.
                </p>
              )}
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  setLoginSubmitted(true);
                  if (!loginId.trim() || !password) return;
                  void act(async () => {
                    try {
                      const pending = request('login', {
                        loginId,
                        password,
                        device: { kind: 'android', model: '', appVersion: '' },
                      });
                      setPassword('');
                      await pending;
                      go('home', true);
                    } catch (e) {
                      if ((e as { code?: string }).code === 'forbidden')
                        setBlocked(true);
                    }
                  });
                }}
              >
                <label>
                  아이디
                  <input
                    autoComplete="off"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    aria-invalid={loginSubmitted && !loginId.trim()}
                    aria-describedby="login-id-error"
                  />
                  {loginSubmitted && !loginId.trim() && (
                    <small id="login-id-error" className="field-error">
                      아이디를 입력해 주세요.
                    </small>
                  )}
                </label>
                <label>
                  비밀번호
                  <input
                    autoComplete="off"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={loginSubmitted && (!password || !!error)}
                    aria-describedby="login-password-error"
                  />
                  {loginSubmitted && !password && !busy && (
                    <small
                      id="login-password-error"
                      role="alert"
                      className="field-error"
                    >
                      {error || '비밀번호를 입력해 주세요.'}
                    </small>
                  )}
                </label>
                <div className="bar">
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={!connected || busy}
                  >
                    {busy ? '확인하는 중입니다' : '로그인'}
                  </button>
                </div>
              </form>
            </main>
          </>
        )}
        {screen === 'home' && (
          <>
            {header('옮길 상품을 고르세요', true)}
            <div className="connections">
              {connection('naver')}
              {connection('band')}
            </div>
            <main className="pad">
              {!active && <UpdateNotice value={app?.update} />}
              <label className="search">
                <input
                  aria-label="상품 검색"
                  placeholder="상품 이름, 국가, 골프장으로 찾기"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <div className="tabs" role="tablist" aria-label="상품 필터">
                <button
                  role="tab"
                  aria-selected={!unposted}
                  onClick={() => {
                    setUnposted(false);
                    setPage(1);
                  }}
                >
                  전체 상품
                </button>
                <button
                  role="tab"
                  aria-selected={unposted}
                  onClick={() => {
                    setUnposted(true);
                    setPage(1);
                  }}
                >
                  안 올린 상품 {unposted ? products.total : ''}
                </button>
              </div>
              {loading && page === 1 && !products.items.length && (
                <div aria-label="처음 불러오는 중" role="status">
                  {[0, 1, 2, 3].map((i) => (
                    <div className="product-skeleton" key={i}>
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              )}
              {loading && page === 1 && !!products.items.length && (
                <p className="load-line" role="status">
                  {q ? `“${q}”으로 찾는 중입니다` : '상품을 불러오는 중입니다'}
                </p>
              )}
              <div
                hidden={loadFailed && page === 1}
              >
                {products.items.map(p => <ProductListItem key={p.productNo} product={p}
                  detail={() => void choose(p.productNo)} publish={() => void choose(p.productNo, true)} />)}
              </div>
              {loading && page > 1 && (
                <p className="list-state" role="status">
                  상품을 더 불러오는 중입니다.
                </p>
              )}
              {loadFailed && (
                <div className="list-state" role="alert">
                  <strong>상품을 불러오지 못했습니다</strong>
                  <p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
                  <button
                    className="btn primary"
                    onClick={() => setRefresh((n) => n + 1)}
                  >
                    다시 불러오기
                  </button>
                </div>
              )}
              {!loading && !loadFailed && !products.items.length && (
                <div className="list-state">
                  <strong>
                    {q
                      ? `“${q}”로 찾은 상품이 없습니다`
                      : unposted
                        ? '모든 상품을 옮겼습니다'
                        : '등록된 상품이 없습니다'}
                  </strong>
                  <p>
                    {q
                      ? '상품 이름, 골프장, 지역 이름으로 다시 찾아보세요.'
                      : '새 상품이 골투에 등록되면 여기에 나타납니다.'}
                  </p>
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setQ('');
                      setUnposted(false);
                      setRefresh((n) => n + 1);
                    }}
                  >
                    {q ? '검색어 지우기' : '전체 상품 보기'}
                  </button>
                </div>
              )}
              {error && !loading && !loadFailed && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              {products.items.length < products.total && (
                <button className="more" onClick={() => setPage((n) => n + 1)}>
                  상품 더 보기
                </button>
              )}
              {active && (
                <button className="more green" onClick={() => go('progress')}>
                  진행하던 작업 보기
                </button>
              )}
            </main>
            {nav('home')}
            {exitHint && <div className="exit-snackbar" role="status">한 번 더 누르면 앱을 끝낼지 묻습니다</div>}
          </>
        )}
        {screen === 'preview' && product && (
          <>
            {back()}
            <main className="pad preview-content">
              <h1 className="title">{product.title}</h1>
              <p className="meta product-meta"><ProductMeta {...product} /></p>
              <ProductPostHistory posts={product.posts} open={url => void act(async () => { await request('post.open', { url }); })} />
              <PostingTags tags={converted?.tags ?? productTags(product, app?.settings?.defaultHashtags ?? [])} />
              <div className="preview-sticky">
                <div className="seg" role="tablist" aria-label="미리보기 채널">
                  {(['blog', 'band'] as const).map((c) => (
                    <button
                      role="tab"
                      aria-selected={preview === c}
                      key={c}
                      onClick={() => setPreview(c)}
                    >
                      {c === 'blog'
                        ? '블로그 모습'
                        : '밴드 모습'}
                    </button>
                  ))}
                </div>
                <button
                  className="option-summary"
                  onClick={() => go('settings')}
                >
                  <span>
                    문장 다듬기 <b>{options.polish ? '켜짐' : '꺼짐'}</b> · 글
                    끝 문구 <b>{options.closing ? '켜짐' : '꺼짐'}</b> · 링크
                    카드 <b>{options.linkCard ? '켜짐' : '꺼짐'}</b>
                  </span>
                  <span className="green">바꾸기</span>
                </button>
              </div>
              {converted ? (
                <ConversionPreview
                  plan={converted[preview]}
                  bandName={chosenBands.map(b => b.name).join(', ')}
                  phone={app?.user?.phone}
                  ratios={sourcePhotoRatios(product.contentsHtml)}
                  expanded
                  droppedStruckCharacters={converted.droppedStruckCharacters}
                />
              ) : (
                <p role="status">
                  {preparing
                    ? '원문을 정리하고 대조하는 중입니다.'
                    : '미리보기를 불러오지 못했습니다.'}
                  {!preparing && (
                    <button onClick={() => setPreviewRefresh((n) => n + 1)}>
                      다시 불러오기
                    </button>
                  )}
                </p>
              )}
              {converted && !converted.verification[preview].matches && (
                <p role="alert">
                  원문과 다른 내용이 있어 옮길 수 없습니다. 상품을 다시 불러와
                  주세요.
                </p>
              )}
            </main>
            {converted && error && !/바뀌|변경|수정/.test(error) && (
              <p className="field-error pad" role="alert">
                {error}
              </p>
            )}
            <div className="bar">
              <button
                className="btn secondary"
                disabled={!converted || preparing}
                onClick={() => {
                  setOptions(old => ({ ...old, closing: app?.myText?.closingOn ?? true }));
                  setMode('draft');
                  setSheet('draft');
                }}
              >
                임시저장<small>공개되지 않음</small>
              </button>
              <button
                className="btn primary"
                disabled={!converted || preparing}
                onClick={openPublish}
              >
                발행하기
              </button>
            </div>
          </>
        )}
        {screen === 'polish' && converted?.polish && (
          <>
            {back('preview')}
            <main className="pad">
              <PolishComparison
                result={converted.polish}
                busy={busy}
                onOpen={() =>
                  setNotice('숫자·날짜·가격과 서식은 원문대로 유지합니다.')
                }
                onRetry={() =>
                  void act(async () => {
                    setConverted(
                      await request('preview.prepare', {
                        productNo: product!.productNo,
                        options,
                        retryPolish: true,
                      }),
                    );
                  })
                }
                onRevert={(paragraphId) =>
                  void act(async () => {
                    setConverted(
                      await request('preview.revert', {
                        productNo: product!.productNo,
                        paragraphId,
                      }),
                    );
                  })
                }
              />
            </main>
            <div className="bar">
              <button
                className="btn quiet"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    for (const p of converted.polish!.paragraphs.filter(
                      (p) =>
                        p.accepted && !p.reverted && p.original !== p.polished,
                    ))
                      setConverted(
                        await request('preview.revert', {
                          productNo: product!.productNo,
                          paragraphId: p.id,
                        }),
                      );
                    await start(true);
                  })
                }
              >
                모두 원문으로
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void start(true)}
              >
                이대로 옮기기
              </button>
            </div>
          </>
        )}
        {screen === 'progress' && job && (
          <>
            {isPublishResult(job) && job.status !== 'record_failed' ? (
              <PublishResult job={job} open={url => void act(async () => { await request('post.open', { url }); })} />
            ) : needsServiceReview(job) ? (
              <main className="center">
                <span className="mark question">!</span>
                <h1>{serviceReviewHeading(job)}</h1>
                <p>{jobMessage(job)[0]}</p>
                <p className="meta">{jobMessage(job)[1]}</p>
                <TableNotice fallback={job.tableModes?.includes('text-list')} />
                {resultRows}
                {job.status === 'record_failed' && <button className="green" disabled={busy} onClick={()=>void act(async()=>{await request('job.retryRecord',{});})}>기록 다시 시도</button>}
              </main>
            ) : job.status === 'running' || job.status === 'recovery_paused' ? (
              <LiveProgress key={job.id} job={job} preview={converted} />
            ) : job.status === 'login_paused' ? (
              <main className="center">
                <span className="mark warn">!</span>
                <h1>
                  {job.service === 'band' ? '밴드' : '네이버'} 로그인이
                  <br />
                  풀렸습니다
                </h1>
                <p>
                  옮기던 글은 그대로 두었습니다. 다시 로그인하면 멈춘 곳부터
                  이어서 진행합니다.
                </p>
                <p className="meta">
                  사진 올리는 중 {job.current}/{job.total}에서 멈춤 ·{' '}
                  {job.targetResults?.some((t) => t.status === 'published')
                    ? '이미 발행한 글이 있음'
                    : '아직 공개되지 않음'}
                </p>
              </main>
            ) : ['draft_saved', 'published'].includes(job.status) ? (
              <main className="center">
                <span className="mark">✓</span>
                <h1>
                  {job.status === 'draft_saved'
                    ? '블로그에 임시저장했습니다'
                    : job.targets.every(t => t.channel === 'band') ? '게시했습니다' : '발행했습니다'}
                </h1>
                <p className="meta">
                  {job.title} · 사진 {product?.images.length ?? job.total}장
                </p>
                <TableNotice fallback={job.tableModes?.includes('text-list')} />
                {resultRows}
                {job.status === 'draft_saved' && (
                  <p className="hint">
                    네이버 블로그 앱의 글쓰기 › 임시저장함에서 확인하고 직접
                    발행할 수 있습니다.
                  </p>
                )}
              </main>
            ) : (
              <main className="center">
                <span
                  className={`mark ${formattingMessage(job.failureCode) || job.status === 'draft_unverified' || resultKind(job) === 'uncertain' ? 'question' : resultKind(job) === 'paused' || job.status === 'stopped' ? 'neutral' : resultKind(job) === 'record' ? '' : 'danger'}`}
                >
                  {formattingMessage(job.failureCode) || job.status === 'draft_unverified'
                    ? '!'
                    : resultKind(job) === 'record'
                      ? '✓'
                      : resultKind(job) === 'uncertain'
                        ? '?'
                        : resultKind(job) === 'paused' ||
                            job.status === 'stopped'
                          ? 'Ⅱ'
                          : '×'}
                </span>
                <h1>
                  {bandPostBlocked(job.failureCode) ? '밴드 게시 요청이 차단됐습니다' : formattingMessage(job.failureCode) ? '서식 확인 필요' : resultKind(job) === 'record'
                    ? job.targetResults?.some((t) => t.status === 'published')
                      ? job.targets.every(t => t.channel === 'band') ? '게시했습니다' : '발행했습니다'
                      : job.targetResults?.some(
                            (t) => t.status === 'draft_saved',
                          )
                        ? '블로그에 임시저장했습니다'
                        : '등록 기록을 저장하지 못했습니다'
                    : resultKind(job) === 'uncertain'
                      ? '올라갔는지 확인이 필요합니다'
                      : resultKind(job) === 'paused'
                        ? '잠시 멈췄습니다'
                        : job.status === 'draft_unverified'
                          ? '임시저장은 됐지만 내용을 다시 확인하지 못했습니다'
                          : job.status === 'stopped'
                            ? '옮기기를 중단했습니다'
                            : '끝까지 옮기지 못했습니다'}
                </h1>
                {(formattingMessage(job.failureCode) || job.status !== 'draft_unverified') && (
                  <p>
                    {bandPostBlocked(job.failureCode) ? jobMessage(job).join(' ') : formattingMessage(job.failureCode) ?? (resultKind(job) === 'record'
                      ? '채널별 결과를 등록 기록에 남기지 못했습니다. 기록을 다시 저장해 주세요.'
                      : resultKind(job) === 'uncertain'
                        ? '앱이 게시 결과를 확인하지 못했습니다. 다시 올리기 전에 해당 서비스에서 먼저 확인해 주세요.'
                        : resultKind(job) === 'paused'
                          ? '작성 중인 내용은 그대로 두었습니다. 채널별 상태를 확인한 뒤 이어서 진행해 주세요.'
                          : jobMessage(job)[0])}
                  </p>
                )}
                <p className="meta">{jobMessage(job)[1]}</p>
                <TableNotice fallback={job.tableModes?.includes('text-list')} />
                {resultRows}
                {job.status === 'dialog_paused' && (
                  <button
                    className="btn primary"
                    onClick={() => setSheet('dialog')}
                  >
                    요청 내용 보기
                  </button>
                )}
              </main>
            )}
            <div className="bar">
              <JobResultActions job={job} busy={busy} act={action=>{
                if (action === 'retryFailed') { void act(async () => { await request('job.retryFailed', {}); go('progress'); }); return; }
                if (action==='history') { go('history'); return; }
                if (action==='close' || action==='home') { setPage(1); go('home'); return; }
                if (action==='stop') { setSheet('stop'); return; }
                if (action==='login') { login(job.service==='band'?'band':'naver','progress',null); return; }
                void act(async()=>{
                  if (action==='cancel') { if (!existingServiceResult(job) && job.status!=='record_failed') await request('job.cancel',{}); go('home'); }
                  if (action==='record') await request('job.retryRecord',{});
                  if (action==='band') await request('job.continueBand',{});
                  if (action==='resume') await request('job.resume',{});
                });
              }}/>
            </div>
          </>
        )}
        {screen === 'connect' && (
          <>
            {back()}
            <main className="pad">
              <h1 className="title">계정 연결</h1>
              <p className="meta">
                글을 올릴 네이버와 밴드에 로그인해 둡니다. 비밀번호는 실제
                네이버·밴드 화면에만 입력하며 앱은 저장하지 않습니다.
              </p>
              {serviceRow('naver')}
              {serviceRow('band')}
            </main>
          </>
        )}
        {screen === 'service' && (
          <>
            <div className="service-top">
              <h1 className="title">
                {service === 'naver' ? '네이버' : '밴드'} 로그인
              </h1>
              <button
                className="green"
                onClick={() =>
                  void act(async () => {
                    await request('service.hide', {});
                    go(returnScreen);
                    setSheet(returnSheet);
                  })
                }
              >
                취소
              </button>
            </div>
            <p className="meta pad">
              직접 로그인해 주세요. 끝나면 이 화면은 저절로 닫힙니다.
            </p>
          </>
        )}
        {screen === 'history' && (
          <>
            <main className="pad">
              <h1 className="title">등록 기록</h1>
              {app?.user?.role === 'admin' && <TodayStatus key={app.user.userNo} refresh={postRefresh} />}
              <div className="tabs" role="tablist" aria-label="기록 범위">
                <button
                  role="tab"
                  aria-selected={scope === 'mine'}
                  onClick={() => {
                    setScope('mine');
                    setPostPage(1);
                  }}
                >
                  내 기록
                </button>
                {(app?.user?.userType ?? 0) >= 7 && (
                  <button
                    role="tab"
                    aria-selected={scope === 'all'}
                    onClick={() => {
                      setScope('all');
                      setPostPage(1);
                    }}
                  >
                    전체
                  </button>
                )}
              </div>
              {posts.items.map((post) => (
                <article className="history-row" key={post.postNo}>
                  <strong>{post.productTitle}</strong>
                  {scope === 'all' && <small>{post.userName}</small>}
                  <p
                    className={`status ${deletedPost(post) ? 'muted' : (post.postUrl && post.status==='failed' || uncertainReason(post.failReason) || formattingMessage(post.failReason)) ? 'uncertain-status' : post.status === 'failed' ? 'danger' : post.status === 'published' ? 'green' : post.status === 'draft_saved' ? 'draft-status' : 'muted'}`}
                  >
                    {historyLine(post, recordTime(post.startedAt))}
                  </p>
                  <TableNotice fallback={post.tableFallback || post.jobLog?.tableFallback} />
                  {!deletedPost(post) && (post.status === 'failed' || uncertainReason(post.failReason) || !!formattingMessage(post.failReason) || post.jobLog && ['failed', 'uncertain'].includes(post.jobLog.result)) && <JobLogFailure log={post.jobLog} reason={post.failReason} step={post.step} />}
                  {post.status === 'published' && post.failReason === 'PUBLISHED_READBACK_INCOMPLETE' && <p className="meta">게시 후 일부 항목을 확인하지 못했습니다.</p>}
                  {post.status === 'published' && post.failReason === 'PUBLISHED_CONTENT_MISSING' && <p className="meta">게시된 글에서 원문 누락을 확인했습니다.</p>}
                  {!deletedPost(post) && formattingMessage(post.failReason) && <p className="meta">{formattingMessage(post.failReason)}</p>}
                  {!deletedPost(post) && post.status === 'failed' && !formattingMessage(post.failReason) && (
                    <p className="meta">
                      {post.postUrl || uncertainReason(post.failReason)
                        ? post.postUrl ? '글은 올라갔습니다. 저장된 글 주소에서 확인해 주세요. 같은 글을 다시 올리지 마세요.' : '저장 또는 게시 결과를 해당 서비스에서 확인해 주세요. 같은 글을 다시 올리지 마세요.'
                        : canRetryHistory(post) ? '공개하기 전에 멈췄습니다. 원인을 확인한 뒤 다시 시도해 주세요.' : '작업 결과를 확인해 주세요. 같은 글을 바로 다시 올리지 마세요.'}
                    </p>
                  )}
                  {!deletedPost(post) && (
                    <div className="row-actions">
                      {post.postUrl && (
                        <button
                          className="green"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await request('post.open', { url: post.postUrl });
                            })
                          }
                        >
                          글 보기
                        </button>
                      )}
                      {(post.status === 'draft_saved' ||
                        post.failReason === 'BLOG_DRAFT_SAVED_UNVERIFIED' || /^BLOG_SAVED_READBACK_|^BLOG_FORMATTING_(AFTER_SAVE|REOPENED):/.test(post.failReason ?? '')) && (
                        <small>네이버 임시저장함에서 확인</small>
                      )}
                      {post.status === 'failed' &&
                        canRetryHistory(post) && (
                          <button
                            className="green"
                            disabled={busy}
                            onClick={() =>
                              active && job?.productNo === post.productNo
                                ? go('progress')
                                : void choose(post.productNo)
                            }
                          >
                            다시 시도
                          </button>
                        )}
                      <PostDeleteAction
                        post={post}
                        scope={scope}
                        busy={busy}
                        prepare={(postNo) =>
                          request('posts.delete.prepare', { postNo })
                        }
                        cancel={async confirmation => { await request('posts.delete.cancel', { confirmation }); }}
                        remove={async (confirmation) => {
                          const result = await request('posts.delete.confirm', {
                            confirmation,
                          });
                          setPostRefresh((n) => n + 1);
                          return result.postDeletion?.outcome;
                        }}
                      />
                    </div>
                  )}
                </article>
              ))}
              {loading && (
                <p className="list-state">등록 기록을 불러오는 중입니다.</p>
              )}
              {loadFailed && (
                <div className="list-state" role="alert">
                  <strong>등록 기록을 불러오지 못했습니다</strong>
                  <p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
                  <button
                    className="btn primary"
                    onClick={() => setPostRefresh((n) => n + 1)}
                  >
                    다시 불러오기
                  </button>
                </div>
              )}
              {!loading && !loadFailed && !posts.items.length && (
                <div className="list-state">
                  <strong>아직 옮긴 글이 없습니다</strong>
                  <p>상품을 골라 임시저장하거나 발행하면 여기에 남습니다.</p>
                  <button className="btn secondary" onClick={() => go('home')}>
                    상품 고르러 가기
                  </button>
                </div>
              )}
              {posts.items.length < posts.total && (
                <button
                  className="more"
                  onClick={() => setPostPage((n) => n + 1)}
                >
                  기록 더 보기
                </button>
              )}
              {app?.postDeletion?.verifiedGone &&
                !app.postDeletion.recorded && (
                  <p>
                    글은 삭제됐지만 등록 기록을 저장하지 못했습니다.
                    <button
                      onClick={() =>
                        void act(async () => {
                          await request('posts.delete.retryRecord', {});
                          setPostRefresh((n) => n + 1);
                        })
                      }
                    >
                      기록 다시 시도
                    </button>
                  </p>
                )}
            </main>
            {nav('history')}
          </>
        )}
        {screen === 'logs' && <JobLogs back={() => go('settings')} />}
        {screen === 'settings' && (
          <>
            {header('설정', true)}
            <main className="pad settings-content">
              {app?.user && <MyTextSettings key={app.user.userNo} user={app.user} saved={app.myText}
                editing={editingMyText} disabled={busy || active}
                save={async value => { await request('myText.save', value, true); }} />}
              <h3>공통 설정 <span className="subheading-note">· 관리자만 바꿈</span></h3>
              {app?.user?.role !== 'admin' ? (
                <>
                  <div className="setting-value">
                    <span>태그로 붙일 정해 둔 글자</span>
                    <small>{settings.defaultHashtags.join(' ') || '없음'}</small>
                  </div>
                  <div className="setting-value">
                    <span>밴드 하루 한도</span>
                    <small>밴드 한 곳에 1건씩 셉니다 · {settings.bandDailyLimit}건</small>
                  </div>
                </>
              ) : (
                <form noValidate onSubmit={event => {
                  event.preventDefault();
                  void act(async () => { await saveSettings(); });
                }}>
                  <label>
                    <span>태그로 붙일 정해 둔 글자</span>
                    <textarea rows={2} value={tagWordsInput}
                      aria-describedby="tag-words-hint"
                      onChange={event => {
                        const text = event.target.value;
                        setTagWordsInput(text);
                        setSettings(old => ({ ...old, defaultHashtags: text.split(/[,\s]+/).filter(Boolean) }));
                      }} />
                    <small id="tag-words-hint">쉼표 또는 띄어쓰기로 구분합니다.</small>
                  </label>
                  <label>
                    밴드 하루 한도
                    <input type="number" min="1" max="10" inputMode="numeric"
                      aria-invalid={settingsAttempted && invalidLimit}
                      aria-describedby="band-limit-hint"
                      value={settings.bandDailyLimit}
                      onChange={event => setSettings(old => ({ ...old, bandDailyLimit: Number(event.target.value) }))} />
                    <small id="band-limit-hint">1부터 10 사이 숫자입니다.</small>
                    {settingsAttempted && invalidLimit && <small className="field-error" role="alert">1부터 10 사이의 정수를 입력해 주세요.</small>}
                  </label>
                  {error && <p className="field-error" role="alert">{error}</p>}
                  <button className="green" disabled={busy} type="submit">공통 설정 저장</button>
                </form>
              )}
              <p className="meta">골투오토 {__GOLTOU_VERSION__} ({__GOLTOU_VERSION_CODE__})</p>
              <UpdateSettings value={app?.update} current={`${__GOLTOU_VERSION__} (${__GOLTOU_VERSION_CODE__})`} disabled={busy || active} />
              <div className="choice-row"><span>작업 로그<small>단계별 진행과 결과 확인</small></span><button className="green" onClick={() => go('logs')}>보기</button></div>
              <div className="choice-row"><span>앱 데이터 옮기기<small>글 옵션·기록의 공개 범위·표 표시만 옮깁니다. 로그인은 포함하지 않습니다.</small></span>
                <div>
                  <button className="green" disabled={busy || active || !preferencesReady} onClick={() => void act(async () => {
                    await preferencesWrites.current;
                    const result = await request('localData.export', {});
                    if (!result.cancelled) setNotice('앱 데이터를 파일로 내보냈습니다. 작업 로그도 따로 내보내 주세요.');
                  })}>데이터 내보내기</button>
                  <button className="green" disabled={busy || active || !preferencesReady} onClick={() => void act(async () => {
                    await preferencesWrites.current;
                    const result = await request('localData.import', {});
                    if (!result.cancelled && result.preferences && result.polishStrength) {
                      const value = result.preferences;
                      setLastBandKeys(value.lastBandKeys);
                      setOptions({ polish: value.polish, closing: app?.myText?.closingOn ?? true, linkCard: value.linkCard, polishStrength: result.polishStrength });
                      setNotice('앱 데이터를 가져왔습니다. 등록 내역과 공통 설정은 같은 골투 계정으로 로그인하면 다시 읽습니다.');
                    }
                  })}>데이터 가져오기</button>
                </div>
              </div>
              {__GOLTOU_DEBUG__ && debug && (
                <div className="choice-row">
                  <span>디버그 편집기 읽기 점검<small>입력·저장하지 않습니다</small></span>
                  <div>
                    <button className="green" disabled={busy || active || app?.services.naver !== 'confirmed'} onClick={() => void act(async () => {
                      await experiment('blog.probe'); setNotice('편집기 읽기 점검을 시작했습니다. 입력·저장하지 않습니다.');
                    })}>점검 열기</button>
                    <button className="green" disabled={busy || active} onClick={() => void act(async () => {
                      await experiment('blog.closeProbe'); setNotice('읽기 점검 창을 닫았습니다.');
                    })}>점검 닫기</button>
                  </div>
                </div>
              )}
              <h3>내 계정</h3>
              <div className="choice-row">
                <span>
                  {app?.user?.name} ·{' '}
                  {app?.user?.role === 'admin'
                    ? '관리자'
                    : app?.user?.role === 'staff'
                      ? '직원'
                      : '매니저'}
                </span>
                <button
                  className="green"
                  onClick={() =>
                    void act(async () => {
                      await request('logout', {});
                      setScope('mine');
                      go('login', true);
                    })
                  }
                >
                  로그아웃
                </button>
              </div>
              <h3>계정 연결</h3>
              {(['naver', 'band'] as const).map((s) => (
                <button
                  className="choice-row full"
                  key={s}
                  onClick={() => go('connect')}
                >
                  <span>
                    네이버 {s === 'naver' ? '블로그' : '밴드'}
                    <small>
                      <LoginStatus state={app?.services[s] ?? 'checking'} />
                    </small>
                  </span>
                  <span className="green">관리</span>
                </button>
              ))}
              <h3>
                내 글 옵션<small>바꾸면 바로 적용됩니다</small>
              </h3>
              {(
                [
                  [
                    'polish',
                    '문장 다듬기',
                    options.polishStrength === 'natural'
                      ? '어색한 문장도 다듬습니다. 숫자·날짜·가격은 바꾸지 않습니다'
                      : '맞춤법과 띄어쓰기만 고칩니다',
                  ],
                  ['linkCard', '골투 링크 카드', '상품 주소를 함께 넣습니다'],
                ] as const
              ).map(([key, label, help]) => (
                <div className="choice-row" key={key}>
                  <span>
                    {label}
                    <small>{help}</small>
                  </span>
                  <Toggle
                    label={label}
                    value={options[key]}
                    disabled={busy || active || !preferencesReady || loading}
                    change={value => setOptions(old => ({ ...old, [key]: value }))}
                  />
                </div>
              ))}
              {options.polish && (
                <PolishStrengthChoice
                  value={options.polishStrength}
                  disabled={busy || active || !preferencesReady || loading}
                  change={(strength) =>
                    void act(async () => {
                      const polishStrength = await request(
                        'polish.setting.save',
                        { strength },
                      );
                      setOptions((old) => ({ ...old, polishStrength }));
                    })
                  }
                />
              )}
              {product && (
                <button className="more green" onClick={() => go('preview')}>
                  미리보기로 돌아가기
                </button>
              )}
            </main>
            {dirtySettings && !editingMyText && (
              <div className="savebar">
                <span>저장하지 않은 변경이 있습니다</span>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await saveSettings();
                    })
                  }
                >
                  저장
                </button>
              </div>
            )}
            {nav('settings')}
          </>
        )}
        {__GOLTOU_DEBUG__ && debug && screen === 'experiments' && (
          <Suspense fallback={null}>
            <Experiments back={() => go('home')} />
          </Suspense>
        )}
      </div>
      {!!app?.user && !active && !sheet && !app.visibleService && <UpdateSheet value={app.update} />}
      {screen === 'progress' && job?.status === 'recovery_paused' && (
        <Sheet
          title={
            job.failureCode === 'AUTO_RECOVER_CONSENT_REQUIRED'
              ? '네이버에 쓰다 만 글이 있습니다'
              : '작성 중인 내용이 달라졌습니다'
          }
          close={() => {}}
          dismissible={false}
        >
          <p>
            {job.failureCode === 'AUTO_RECOVER_CONSENT_REQUIRED'
              ? '네이버 편집기에 남은 쓰다 만 글이며, 버려도 임시저장함의 글이나 발행한 글은 지워지지 않습니다.'
              : '작성 중인 내용을 버리고 새로 쓸지 골라 주세요.'}
          </p>
          <div className="acts">
            <button
              className="btn quiet"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request('job.recovery', { discard: false });
                })
              }
            >
              그만두기
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request('job.recovery', { discard: true });
                })
              }
            >
              버리고 새로 쓰기
            </button>
          </div>
        </Sheet>
      )}
      {(screen === 'preview' || screen === 'polish') &&
        /바뀌|변경|수정/.test(error ?? '') &&
        !sheet && (
          <Sheet
            title="상품 내용이 바뀌었습니다"
            close={() => {}}
            dismissible={false}
          >
            <p>
              미리보기를 본 뒤에 상품이 수정됐습니다. 바뀐 내용을 다시 확인한 뒤
              옮겨 주세요.
            </p>
            <div className="acts">
              <button className="btn quiet" onClick={() => go('home')}>
                옮기지 않기
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  clearError();
                  setPreviewRefresh((n) => n + 1);
                  if (screen === 'polish') go('preview');
                }}
              >
                새 내용 미리보기
              </button>
            </div>
          </Sheet>
        )}
      {sheet && (
        <Sheet
          key={sheet}
          centered={sheet === 'exit'}
          footer={sheet === 'publish' ? <>
            {limitWarning && <div className="warnline" role="status">{limitWarning}</div>}
            <div className="acts">
              <button className="btn quiet" onClick={sheetClose}>취소</button>
              <button className="btn primary" disabled={!canStart} onClick={() => setSheet('confirm')}>
                {targets().length}곳에 발행
              </button>
            </div>
          </> : undefined}
          title={
            sheet === 'exit'
              ? '골투오토를 끝낼까요?'
              : sheet === 'dialog'
                ? `${job?.service === 'band' ? '밴드' : '네이버'}에서 확인을 요청했습니다`
                : sheet === 'leave'
                  ? '저장하지 않은 변경이 있습니다'
                  : sheet === 'draft'
                    ? '임시저장'
                    : sheet === 'publish'
                      ? '어디에 발행할까요?'
                      : sheet === 'confirm'
                        ? '이대로 발행할까요?'
                        : '옮기기를 중단할까요?'
          }
          close={sheetClose}
        >
          {sheet === 'exit' && (
            <>
              <p>{job?.status === 'running' ? '올리는 중인 작업이 멈춥니다.' : '다음에 열면 상품 목록부터 시작합니다.'}</p>
              <div className="acts">
                <button className="btn quiet" disabled={busy} onClick={closeExit}>취소</button>
                <button className="btn primary" disabled={busy} onClick={() => void act(async () => {
                  await request('app.exit', { event: 'finish' });
                  setSheet(null);
                })}>끝내기</button>
              </div>
            </>
          )}
          {sheet === 'dialog' && job?.dialog && (
            <>
              <p>서비스가 아래 내용을 물었습니다.</p>
              <blockquote className="service-quote">
                <small>서비스가 보낸 내용 그대로</small>
                {job.dialog.message}
              </blockquote>
              <div className="acts">
                {job.dialog.kind !== 'alert' && (
                  <button
                    className="btn quiet"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await request('job.dialog', {
                          id: job.dialog!.id,
                          accept: false,
                        });
                        setSheet(null);
                      })
                    }
                  >
                    취소<small>요청을 취소하고 잠시 멈춥니다</small>
                  </button>
                )}
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await request('job.dialog', {
                        id: job.dialog!.id,
                        accept: true,
                      });
                      setSheet(null);
                    })
                  }
                >
                  확인
                  <small>
                    {job.dialog.kind === 'alert'
                      ? '알림을 닫고 결과를 확인합니다'
                      : '요청에 동의하고 결과를 확인합니다'}
                  </small>
                </button>
              </div>
            </>
          )}
          {sheet === 'leave' && (
            <>
              <p>공통 설정에서 바꾼 내용이 아직 저장되지 않았습니다.</p>
              <div className="acts">
                <button
                  className="btn quiet"
                  onClick={() => {
                    if (app?.settings) {
                      setSettings(app.settings);
                      setTagWordsInput(app.settings.defaultHashtags.join(', '));
                    }
                    go(pendingNavigation, false, true);
                  }}
                >
                  버리고 나가기
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      if (await saveSettings())
                        go(pendingNavigation, false, true);
                    })
                  }
                >
                  저장
                </button>
              </div>
              {settingsAttempted && invalidLimit && (
                <p className="field-error">
                  하루 밴드 게시 한도는 1부터 10 사이의 정수입니다.
                </p>
              )}
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
          {error && sheet !== 'leave' && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {sheet === 'draft' && (
            <>
              <p>
                네이버 블로그의 임시저장함에 저장합니다. 다른 사람에게 보이지
                않습니다.
              </p>
              <div className="pick on">
                <span className="check-box">✓</span>
                <span>
                  <strong>네이버 블로그</strong>
                  <small>
                    {app?.services.naver === 'confirmed'
                      ? '임시저장함에 저장'
                      : '로그인이 필요합니다'}
                  </small>
                </span>
              </div>
              <div className="pick disabled">
                <span className="check-box" />
                <span>
                  <strong>네이버 밴드</strong>
                  <small>
                    밴드에는 임시저장이 없어 발행할 때만 올릴 수 있습니다
                  </small>
                </span>
              </div>
              <div className="acts">
                <button className="btn quiet" onClick={sheetClose}>
                  취소
                </button>
                <button
                  className="btn primary"
                  disabled={!canStart}
                  onClick={() => void start()}
                >
                  블로그에 임시저장
                </button>
              </div>
            </>
          )}
          {sheet === 'publish' && (
            <>
              <p>블로그는 한 곳, 밴드는 여러 곳에 올릴 수 있습니다.</p>
              <PreviousPublication product={products.items.find(item => item.productNo === product?.productNo)} />
              <button
                className={`pick ${blog ? 'on' : ''}`}
                role="checkbox"
                aria-checked={blog}
                onClick={() => setBlog(!blog)}
              >
                <span className="check-box">{blog ? '✓' : ''}</span>
                <span>
                  <strong>네이버 블로그</strong>
                  <small>공개 범위를 고르세요</small>
                </span>
              </button>
              {blog && (
                <div
                  className="two"
                  role="radiogroup"
                  aria-label="블로그 공개 범위"
                >
                  {(['public', 'private'] as const).map((value) => (
                    <button
                      className={value === visibility ? 'on' : ''}
                      role="radio"
                      aria-checked={value === visibility}
                      key={value}
                      onClick={() => setVisibility(value)}
                    >
                      {value === 'public' ? '전체공개' : '비공개'}
                    </button>
                  ))}
                </div>
              )}
              {app?.services.naver !== 'confirmed' && blog && (
                <button
                  className="green"
                  onClick={() => login('naver', screen, 'publish')}
                >
                  네이버 로그인
                </button>
              )}
              {app?.services.band === 'confirmed' ? (
                <section className="publish-bands">
                  <BandListStatus title={`밴드 · ${chosenBands.length}곳 고름`} savedAt={bandsSavedAt}
                    loading={loadingBands || refreshingBands} refresh={() => void loadBands(true)} />
                  {bandsFailed && <p className="band-list-error" role="alert">
                    {!bands.length && '밴드 목록을 읽지 못했습니다. '}{bandListFailureHint(bandsFailureReason)}
                  </p>}
                  {!bandsFailed && !loadingBands && !refreshingBands && !bands.length &&
                    <p className="meta">글을 쓸 수 있는 밴드가 없습니다. 밴드 앱에서 가입한 밴드와 글쓰기 권한을 확인해 주세요.</p>}
                  <BandChooser bands={bands} value={bandKeys} posts={product?.posts} choose={key => {
                    bandSelectionTouched.current = true;
                    setPreselectedBands(false);
                    setBandKeys(keys => keys.includes(key) ? keys.filter(value => value !== key) : [...keys, key]);
                  }} />
                  {!!chosenBands.length && <div className="band-selection">
                    <span>{preselectedBands && '지난번에 고른 밴드를 그대로 체크해 두었습니다.'}</span>
                    <button className="green" onClick={() => {
                      bandSelectionTouched.current = true;
                      setBandKeys([]);
                      setPreselectedBands(false);
                    }}>모두 해제</button>
                  </div>}
                </section>
              ) : (
                <div className="pick disabled">
                  <span className="check-box" />
                  <span>
                    <strong>네이버 밴드</strong>
                    <small>
                      {app?.services.band === 'checking'
                        ? '연결 상태를 확인하는 중입니다'
                        : app?.services.band === 'unknown'
                          ? '밴드 연결을 확인하지 못했습니다.'
                          : '밴드 로그인이 필요합니다'}
                    </small>
                  </span>
                  <button
                    className="green"
                    disabled={app?.services.band === 'checking'}
                    onClick={() =>
                      app?.services.band === 'unknown'
                        ? void act(async () => {
                            await request('service.check', { service: 'band' });
                          })
                        : login('band', screen, 'publish')
                    }
                  >
                    {app?.services.band === 'checking'
                      ? '확인 중'
                      : app?.services.band === 'unknown'
                        ? '다시 확인'
                        : '로그인'}
                  </button>
                </div>
              )}
              <TextSwitch label="글 끝 문구 넣기" checked={options.closing} disabled={busy}
                detail={<UnbrokenPhone text={fillMyText(app?.myText?.closing ?? defaultMyText().closing, app?.user ?? { name: '' })} phone={app?.user?.phone} />}
                change={closing => setOptions(old => ({ ...old, closing }))} />
              {startReason && startReason !== limitWarning && (
                <p className="why-disabled" role="status">
                  {startReason}
                  {!active && !preparing && !converted && <button onClick={() => setPreviewRefresh(n => n + 1)}>다시 불러오기</button>}
                </p>
              )}
            </>
          )}
          {sheet === 'confirm' && (
            <>
              <p>{product?.title}</p>
              <div className="result-rows">
                {blog && (
                  <div>
                    <span>네이버 블로그</span>
                    <strong>
                      {visibility === 'public' ? '전체공개' : '비공개'}
                    </strong>
                  </div>
                )}
                {band && chosenBands.map(chosen => (
                  <div key={chosen.key}>
                    <span>네이버 밴드</span>
                    <strong>{chosen.name}</strong>
                  </div>
                ))}
              </div>
              <div className="warnline">
                발행하면{' '}
                {band || (blog && visibility === 'public')
                  ? '바로 다른 사람에게 보입니다'
                  : '나만 볼 수 있는 글로 올라갑니다'}
                . 올린 뒤에는 등록 기록에서 글을 삭제할 수 있습니다.
              </div>
              <div className="acts">
                <button
                  className="btn quiet"
                  onClick={() => setSheet('publish')}
                >
                  뒤로
                </button>
                <button
                  className="btn primary"
                  disabled={!canStart}
                  onClick={() => void start()}
                >
                  {targets().length}곳에 발행
                </button>
              </div>
            </>
          )}
          {sheet === 'stop' && (
            <>
              <p>
                {job?.targetResults?.some((t) => t.status === 'published')
                  ? '이미 발행한 글은 남겨 두고 현재 쓰던 글만 버립니다.'
                  : job?.targetResults?.some((t) => t.status === 'draft_saved')
                    ? '임시저장한 글은 남겨 두고 현재 쓰던 글만 버립니다. 공개된 것은 없습니다.'
                    : '쓰던 글은 버립니다. 아직 공개된 것은 없습니다.'}
              </p>
              <div className="acts">
                <button className="btn quiet" onClick={sheetClose}>
                  계속 옮기기
                </button>
                <button
                  className="btn destructive"
                  disabled={busy || job?.activity?.stage === 'submit'}
                  onClick={() =>
                    void act(async () => {
                      await request('job.cancel', {});
                      setSheet(null);
                    })
                  }
                >
                  중단
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

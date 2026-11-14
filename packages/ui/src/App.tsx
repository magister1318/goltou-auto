import React, { lazy, Suspense, useEffect, useState } from 'react';
import type {
  Mode,
  Page,
  Post,
  PostInput,
  Product,
  ProductSummary,
  Settings,
} from '@goltou/api-client';
import type { Commands, JobInput, Service } from '@goltou/core/protocol';
import type { PreparedPreview } from '@goltou/core';
import { deletedPost } from '@goltou/core/post-delete-policy';
import { clearError, request, useStore } from './store';
import { ProductPhoto } from './ProductPhoto';
import { BrandMark } from './BrandMark';
import { ConversionPreview } from './ConversionPreview';
import { ServiceGuide, LoginStatus, type LoginService } from './ServiceLogin';
import { initialPreviewOptions } from './polish-setting';
import { PolishStrengthChoice } from './PolishStrengthChoice';
import { PolishComparison } from './PolishComparison';
import { PostDeleteAction } from './PostDeleteAction';
import { Sheet } from './Sheet';
import { LiveProgress } from './LiveProgress';
import { jobMessage } from './job-message';
const Experiments = __GOLTOU_DEBUG__
  ? lazy(() =>
      import('./Experiments').then((m) => ({ default: m.ExperimentsScreen })),
    )
  : () => null;
type Screen =
  | 'login'
  | 'home'
  | 'preview'
  | 'progress'
  | 'connect'
  | 'service'
  | 'history'
  | 'settings'
  | 'experiments';
type SheetName = 'draft' | 'publish' | 'confirm' | 'stop' | null;
type Band = Commands['bands.list']['output'][number];
const ignore = () => {};
const money = (value: number) => `${value.toLocaleString('ko-KR')}원`;
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
  const [mode, setMode] = useState<Mode>('draft'),
    [blog, setBlog] = useState(true),
    [band, setBand] = useState(false),
    [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [bands, setBands] = useState<Band[]>([]),
    [bandKey, setBandKey] = useState(''),
    [loadingBands, setLoadingBands] = useState(false),
    [bandsFailed, setBandsFailed] = useState(false);
  const [service, setService] = useState<LoginService>('naver'),
    [loginOpened, setLoginOpened] = useState(false),
    [returnScreen, setReturnScreen] = useState<Screen>('connect'),
    [returnSheet, setReturnSheet] = useState<SheetName>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine'),
    [posts, setPosts] = useState<Page<Post>>({ items: [], total: 0 }),
    [postPage, setPostPage] = useState(1),
    [postRefresh, setPostRefresh] = useState(0);
  const [settings, setSettings] = useState<Settings>({
    closingText: '',
    defaultHashtags: [],
    bandDailyLimit: 3,
  });
  const job = app?.job;
  const active =
    !!job && !['draft_saved', 'published', 'stopped'].includes(job.status);
  function go(next: Screen, replace = false) {
    clearError();
    setNotice('');
    setSheet(null);
    setScreen(next);
    history[replace ? 'replaceState' : 'pushState'](
      { screen: next },
      '',
      location.pathname,
    );
    window.scrollTo(0, 0);
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
    const pop = () => {
      setSheet(null);
      setScreen(history.state?.screen ?? (app?.user ? 'home' : 'login'));
      clearError();
      void request('service.hide', {}).catch(ignore);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [!!app?.user]);
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
    if (app?.settings) setSettings(app.settings);
  }, [app?.settings]);
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
    const timer = setTimeout(() => {
      void request('products.list', {
        q,
        onlyUnposted: unposted,
        page,
        pageSize: 10,
      })
        .then((data) => {
          if (live)
            setProducts((old) => ({
              ...data,
              items: page === 1 ? data.items : [...old.items, ...data.items],
            }));
        })
        .catch(() => {
          if (live) setLoadFailed(true);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [screen, app?.user?.userNo, q, unposted, page, refresh]);
  useEffect(() => {
    if (!product || screen !== 'preview') return;
    let live = true;
    setPreparing(true);
    void request('preview.prepare', { productNo: product.productNo, options })
      .then((data) => {
        if (live) setConverted(data);
      })
      .catch(ignore)
      .finally(() => {
        if (live) setPreparing(false);
      });
    return () => {
      live = false;
    };
  }, [screen, product?.productNo, options, previewRefresh]);
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
  async function loadBands() {
    setLoadingBands(true);
    setBandsFailed(false);
    try {
      const rows = await request('bands.list', {});
      setBands(rows);
      setBandKey((old) =>
        rows.some((b) => b.key === old) ? old : (rows[0]?.key ?? ''),
      );
    } catch {
      setBandsFailed(true);
    } finally {
      setLoadingBands(false);
    }
  }
  useEffect(() => {
    if (sheet === 'publish' && app?.services.band === 'confirmed')
      void loadBands();
  }, [sheet, app?.services.band]);
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
  async function choose(no: number) {
    await act(async () => {
      const data = await request('products.get', { productNo: no });
      setProduct(data);
      setConverted(null);
      setPreview('blog');
      setBlog(true);
      setBand(false);
      setVisibility('public');
      setMode('draft');
      go('preview');
    });
  }
  function login(service: LoginService, to = screen, toSheet = sheet) {
    setService(service);
    setReturnScreen(to);
    setReturnSheet(toSheet);
    setLoginOpened(false);
    go('service');
  }
  function targets(): JobInput['targets'] {
    return [
      ...(blog || mode === 'draft'
        ? [{ channel: 'blog' as const, key: 'overseas', name: '해외골프' }]
        : []),
      ...(mode === 'publish' && band && bands.find((b) => b.key === bandKey)
        ? [
            {
              channel: 'band' as const,
              key: bandKey,
              name: bands.find((b) => b.key === bandKey)!.name,
            },
          ]
        : []),
    ];
  }
  async function start() {
    if (!product || !converted) return;
    if ((mode === 'draft' || blog) && app?.services.naver !== 'confirmed') {
      login('naver', 'preview', sheet);
      return;
    }
    await act(async () => {
      await request('job.start', {
        productNo: product.productNo,
        mode,
        blogVisibility: visibility,
        targets: targets(),
        options,
        publishConfirmed: mode === 'publish',
        previewHash: converted.contentHash,
      });
      go('progress');
    });
  }
  function nav(selected: Screen) {
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
      ← {to === 'home' ? '상품 목록' : '돌아가기'}
    </button>
  );
  const header = (title: React.ReactNode, home = false) => (
    <header>
      <div className="brand-row">
        <span className="brand">
          <BrandMark />
          골투오토
        </span>
        {home && <span>{app?.user?.name} 님</span>}
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
        ) : (
          <button
            className="green"
            disabled={busy}
            onClick={() => login(s, 'connect', null)}
          >
            로그인
          </button>
        )}
        <button
          className="small"
          disabled={busy || app?.services[s] === 'checking'}
          onClick={() =>
            void act(async () => {
              await request('service.check', { service: s });
            })
          }
        >
          다시 확인
        </button>
      </div>
    </div>
  );
  const resultRows = (
    <div className="result-rows">
      {job?.targetResults?.map((t) => (
        <div key={`${t.channel}:${t.key}`}>
          <span>
            {t.channel === 'blog' ? '블로그' : '밴드'} ·{' '}
            {t.status === 'draft_saved'
              ? '임시저장'
              : t.status === 'published'
                ? '발행'
                : t.status === 'failed'
                  ? '실패'
                  : '중단'}
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
          ) : (
            <small>{t.status === 'draft_saved' ? '공개되지 않음' : ''}</small>
          )}
        </div>
      ))}
    </div>
  );
  const sheetClose = () => setSheet(null);
  const canStart =
    !!converted &&
    !preparing &&
    !busy &&
    targets().length > 0 &&
    targets().every((t) => converted.verification[t.channel].matches) &&
    !(band && (loadingBands || bandsFailed));
  return (
    <div className={`app screen-${screen}`}>
      <div className="app-body">
        {(error || app?.serviceError) && (
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
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(async () => {
                    try {
                      const pending = request('login', {
                        loginId,
                        password,
                        device: { kind: 'android', model: '', appVersion: '' },
                      });
                      setLoginId('');
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
                    required
                  />
                </label>
                <label>
                  비밀번호
                  <input
                    autoComplete="off"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <div className="bar">
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={!connected || busy}
                  >
                    {busy ? '로그인 중…' : '로그인'}
                  </button>
                </div>
              </form>
            </main>
          </>
        )}
        {screen === 'home' && (
          <>
            {header(
              <>
                옮길 상품을
                <br />
                고르세요
              </>,
              true,
            )}
            <div className="connections">
              {connection('naver')}
              {connection('band')}
            </div>
            <main className="pad">
              <label className="search">
                <input
                  aria-label="상품 검색"
                  placeholder="상품 이름, 골프장, 지역으로 찾기"
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
                  전체 {!unposted ? products.total : ''}
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
              {products.items.map((p) => (
                <button
                  className="product-row"
                  key={p.productNo}
                  disabled={busy || active}
                  onClick={() => void choose(p.productNo)}
                >
                  <span className="product-copy">
                    <strong>{p.title}</strong>
                    <small>
                      {p.country} {p.region} · {money(p.priceFrom)}부터 · 출발일{' '}
                      {p.departureCount}개
                    </small>
                    <span
                      className={`tag ${p.myPosts.blog || p.myPosts.band ? 'green' : 'muted'}`}
                    >
                      {p.myPosts.blog || p.myPosts.band
                        ? (['blog', 'band'] as const)
                            .filter((c) => p.myPosts[c])
                            .map(
                              (c) =>
                                `${c === 'blog' ? '블로그' : '밴드'} ${p.myPosts[c]!.at.slice(5, 10).replace('-', '.')} ${p.myPosts[c]!.status === 'published' ? '발행' : p.myPosts[c]!.status === 'draft_saved' ? '임시저장' : '기록 있음'}`,
                            )
                            .join(' · ')
                        : '아직 올리지 않음'}
                    </span>
                  </span>
                  <ProductPhoto url={p.thumbUrl} />
                </button>
              ))}
              {loading && (
                <p className="list-state">상품을 불러오는 중입니다.</p>
              )}
              {loadFailed && (
                <p>
                  상품을 불러오지 못했습니다.
                  <button onClick={() => setRefresh((n) => n + 1)}>
                    다시 불러오기
                  </button>
                </p>
              )}
              {!loading && !loadFailed && !products.items.length && (
                <p className="list-state">
                  조건에 맞는 상품이 없습니다. 검색어를 바꿔 보세요.
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
          </>
        )}
        {screen === 'preview' && product && (
          <>
            {back()}
            <main className="pad preview-content">
              <h1 className="title">{product.title}</h1>
              <p className="meta">
                {product.country} {product.region} ·{' '}
                {product.departures.length
                  ? `${money(Math.min(...product.departures.map((d) => d.price)))}부터 · `
                  : ''}
                사진 {product.images.length}장
              </p>
              <div className="seg" role="tablist" aria-label="미리보기 채널">
                {(['blog', 'band'] as const).map((c) => (
                  <button
                    role="tab"
                    aria-selected={preview === c}
                    key={c}
                    onClick={() => setPreview(c)}
                  >
                    {c === 'blog'
                      ? '블로그에 올라갈 모습'
                      : '밴드에 올라갈 모습'}
                  </button>
                ))}
              </div>
              {converted ? (
                <ConversionPreview
                  plan={converted[preview]}
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
              <button className="option-summary" onClick={() => go('settings')}>
                <span>
                  문장 다듬기 <b>{options.polish ? '켜짐' : '꺼짐'}</b> · 글 끝
                  문구 <b>{options.closing ? '켜짐' : '꺼짐'}</b>
                </span>
                <span className="green">바꾸기</span>
              </button>
            </main>
            <div className="bar">
              <button
                className="btn secondary"
                disabled={!converted || preparing}
                onClick={() => {
                  setMode('draft');
                  setSheet('draft');
                }}
              >
                임시저장<small>공개되지 않음</small>
              </button>
              <button
                className="btn primary"
                disabled={!converted || preparing}
                onClick={() => {
                  setMode('publish');
                  setVisibility('public');
                  setSheet('publish');
                }}
              >
                발행<small>바로 공개됨</small>
              </button>
            </div>
          </>
        )}
        {screen === 'progress' && job && (
          <>
            {job.status === 'running' ? (
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
                    : '발행했습니다'}
                </h1>
                <p className="meta">
                  {job.title} · 사진 {product?.images.length ?? job.total}장
                </p>
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
                <span className="mark danger">×</span>
                <h1>
                  {job.status === 'stopped'
                    ? '옮기기를 중단했습니다'
                    : '끝까지 옮기지 못했습니다'}
                </h1>
                <p>{jobMessage(job)[0]}</p>
                <p className="meta">{jobMessage(job)[1]}</p>
                {resultRows}
                {job.status === 'dialog_paused' && (
                  <div>
                    <p>
                      서비스에서 확인을 요청했습니다. 선택한 뒤 이어서 진행해
                      주세요.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await request('job.dialog', {
                            id: job.dialog!.id,
                            accept: false,
                          });
                        })
                      }
                    >
                      취소
                    </button>
                    <button
                      onClick={() =>
                        void act(async () => {
                          await request('job.dialog', {
                            id: job.dialog!.id,
                            accept: true,
                          });
                        })
                      }
                    >
                      확인
                    </button>
                  </div>
                )}
                {job.status === 'recovery_paused' && (
                  <p>
                    작성 중인 글이 있습니다.
                    <button
                      onClick={() =>
                        void act(async () => {
                          await request('job.recovery', { discard: true });
                        })
                      }
                    >
                      쓰던 글을 버리고 새로 시작
                    </button>
                  </p>
                )}
              </main>
            )}
            <div className="bar">
              {job.status === 'running' ? (
                <button
                  className="btn quiet"
                  disabled={job.activity?.stage === 'submit'}
                  onClick={() => setSheet('stop')}
                >
                  중단
                </button>
              ) : job.status === 'login_paused' ? (
                <>
                  <button className="btn quiet" onClick={() => go('home')}>
                    나중에 하기
                  </button>
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      login(
                        job.service === 'band' ? 'band' : 'naver',
                        'progress',
                        null,
                      )
                    }
                  >
                    다시 로그인
                  </button>
                </>
              ) : ['draft_saved', 'published', 'stopped'].includes(
                  job.status,
                ) ? (
                <>
                  <button
                    className="btn secondary"
                    onClick={() => go('history')}
                  >
                    등록 기록
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setPage(1);
                      go('home');
                    }}
                  >
                    다른 상품 옮기기
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn quiet"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        if (
                          !job.publicationUncertain &&
                          job.status !== 'record_failed'
                        )
                          await request('job.cancel', {});
                        go('home');
                      })
                    }
                  >
                    그만두기
                  </button>
                  {job.status === 'record_failed' ? (
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await request('job.retryRecord', {});
                        })
                      }
                    >
                      기록 다시 시도
                    </button>
                  ) : job.status === 'channel_paused' &&
                    !job.publicationUncertain ? (
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await request('job.continueBand', {});
                        })
                      }
                    >
                      블로그 실패 확인 · 밴드 진행
                    </button>
                  ) : !/BAND_POST_UNCONFIRMED|BLOG_PUBLISH/.test(
                      job.failureCode ?? '',
                    ) &&
                    !job.publicationUncertain &&
                    ['failed', 'user_paused'].includes(job.status) ? (
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await request('job.resume', {});
                        })
                      }
                    >
                      {job.status === 'user_paused' ? '이어하기' : '다시 시도'}
                    </button>
                  ) : (
                    <button
                      className="btn secondary"
                      onClick={() => go('history')}
                    >
                      등록 기록
                    </button>
                  )}
                </>
              )}
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
            {back(returnScreen)}
            <main className="pad">
              <h1 className="title">
                {service === 'naver' ? '네이버' : '밴드'} 로그인
              </h1>
              <ServiceGuide
                service={service}
                state={app?.services[service] ?? 'checking'}
              />
              <p className="meta">로그인이 끝나면 이 화면은 저절로 닫힙니다.</p>
            </main>
            <div className="bar">
              <button
                className="btn primary"
                disabled={busy || !connected}
                onClick={() =>
                  void act(async () => {
                    await request('service.show', { service });
                    setLoginOpened(true);
                  })
                }
              >
                {service === 'naver' ? '네이버' : '밴드'} 로그인 화면 열기
              </button>
            </div>
          </>
        )}
        {screen === 'history' && (
          <>
            <main className="pad">
              <h1 className="title">등록 기록</h1>
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
                    className={`status ${post.status === 'failed' ? 'danger' : 'green'}`}
                  >
                    {post.channel === 'blog' ? '블로그' : '밴드'}{' '}
                    {deletedPost(post)
                      ? '삭제함'
                      : post.status === 'published'
                        ? '발행'
                        : post.status === 'draft_saved'
                          ? '임시저장'
                          : post.status === 'failed'
                            ? '실패 · 공개 여부는 해당 서비스에서 확인'
                            : post.status === 'running'
                              ? '진행 중'
                              : '중단'}{' '}
                    · {post.startedAt.replace('T', ' ').slice(5, 16)}
                  </p>
                  {!deletedPost(post) && (
                    <div className="row-actions">
                      {post.status === 'published' && post.postUrl && (
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
                      {post.status === 'draft_saved' && (
                        <small>네이버 임시저장함에서 확인</small>
                      )}
                      {post.status === 'failed' &&
                        !/BAND_POST_UNCONFIRMED|BLOG_PUBLISH/.test(
                          post.failReason,
                        ) && (
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
                        remove={async (confirmation) => {
                          await request('posts.delete.confirm', {
                            confirmation,
                          });
                          setPostRefresh((n) => n + 1);
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
                <button onClick={() => setPostRefresh((n) => n + 1)}>
                  등록 기록 다시 불러오기
                </button>
              )}
              {!loading && !loadFailed && !posts.items.length && (
                <p className="list-state">아직 등록 기록이 없습니다.</p>
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
        {screen === 'settings' && (
          <>
            <main className="pad settings-content">
              <h1 className="title">설정</h1>
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
              <h3>글 옵션</h3>
              {(
                [
                  ['polish', '문장 다듬기', '맞춤법과 띄어쓰기만 고칩니다'],
                  ['closing', '글 끝 문구 넣기', '예약 문의 안내 등'],
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
                    disabled={busy || active}
                    change={(value) =>
                      setOptions((old) => ({ ...old, [key]: value }))
                    }
                  />
                </div>
              ))}
              {options.polish && (
                <PolishStrengthChoice
                  value={options.polishStrength}
                  disabled={busy || active}
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
              <div className="choice-row">
                <span>기본 해시태그</span>
                <small>{settings.defaultHashtags.join(' ') || '없음'}</small>
              </div>
              {app?.user?.role === 'admin' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(async () => {
                      await request('settings.save', settings);
                      setNotice('공통 설정을 저장했습니다.');
                    });
                  }}
                >
                  <label>
                    끝 문구
                    <textarea
                      value={settings.closingText}
                      onChange={(e) =>
                        setSettings((old) => ({
                          ...old,
                          closingText: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    기본 해시태그 (쉼표로 구분)
                    <input
                      value={settings.defaultHashtags.join(', ')}
                      onChange={(e) =>
                        setSettings((old) => ({
                          ...old,
                          defaultHashtags: e.target.value
                            .split(',')
                            .map((v) => v.trim()),
                        }))
                      }
                    />
                  </label>
                  <label>
                    밴드 하루 한도
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={settings.bandDailyLimit}
                      onChange={(e) =>
                        setSettings((old) => ({
                          ...old,
                          bandDailyLimit: Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                  <button className="green" disabled={busy} type="submit">
                    공통 설정 저장
                  </button>
                </form>
              )}
              {product && (
                <button className="more green" onClick={() => go('preview')}>
                  미리보기로 돌아가기
                </button>
              )}
              {options.polish && converted?.polish && (
                <PolishComparison
                  result={converted.polish}
                  busy={busy}
                  onOpen={() =>
                    setNotice(
                      '문장 다듬기는 설정한 범위에서 자동으로 진행합니다.',
                    )
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
                  onRetry={() => setPreviewRefresh((n) => n + 1)}
                />
              )}
            </main>
            {nav('settings')}
          </>
        )}
        {__GOLTOU_DEBUG__ && debug && screen === 'experiments' && (
          <Suspense fallback={null}>
            <Experiments back={() => go('home')} />
          </Suspense>
        )}
      </div>
      {sheet && (
        <Sheet
          key={sheet}
          title={
            sheet === 'draft'
              ? '임시저장'
              : sheet === 'publish'
                ? '발행'
                : sheet === 'confirm'
                  ? '이대로 발행할까요?'
                  : '옮기기를 중단할까요?'
          }
          close={sheetClose}
        >
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
              <p>고른 곳에 바로 올립니다.</p>
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
                  onClick={() => login('naver', 'preview', 'publish')}
                >
                  네이버 로그인
                </button>
              )}
              {app?.services.band === 'confirmed' ? (
                <>
                  <button
                    className={`pick ${band ? 'on' : ''}`}
                    role="checkbox"
                    aria-checked={band}
                    disabled={loadingBands || !bands.length}
                    onClick={() => setBand(!band)}
                  >
                    <span className="check-box">{band ? '✓' : ''}</span>
                    <span>
                      <strong>
                        네이버 밴드{' '}
                        {bands.find((b) => b.key === bandKey)?.name
                          ? `· ${bands.find((b) => b.key === bandKey)!.name}`
                          : ''}
                      </strong>
                      <small>
                        {loadingBands
                          ? '내 밴드를 확인하는 중'
                          : '선택한 밴드에 게시'}
                      </small>
                    </span>
                  </button>
                  {band && (
                    <label>
                      올릴 밴드
                      <select
                        aria-label="올릴 밴드"
                        value={bandKey}
                        onChange={(e) => setBandKey(e.target.value)}
                      >
                        {bands.map((b) => (
                          <option key={b.key} value={b.key}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {bandsFailed && (
                    <p>
                      밴드 목록을 확인하지 못했습니다.
                      <button onClick={() => void loadBands()}>
                        다시 확인
                      </button>
                    </p>
                  )}
                </>
              ) : (
                <div className="pick disabled">
                  <span className="check-box" />
                  <span>
                    <strong>네이버 밴드</strong>
                    <small>밴드 로그인이 필요합니다</small>
                  </span>
                  <button
                    className="green"
                    onClick={() => login('band', 'preview', 'publish')}
                  >
                    로그인
                  </button>
                </div>
              )}
              <div className="acts">
                <button className="btn quiet" onClick={sheetClose}>
                  취소
                </button>
                <button
                  className="btn primary"
                  disabled={!canStart}
                  onClick={() => setSheet('confirm')}
                >
                  다음
                </button>
              </div>
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
                {band && (
                  <div>
                    <span>네이버 밴드</span>
                    <strong>
                      {bands.find((b) => b.key === bandKey)?.name}
                    </strong>
                  </div>
                )}
              </div>
              <div className="warnline">
                발행하면{' '}
                {band || (blog && visibility === 'public')
                  ? '바로 다른 사람에게 보입니다'
                  : '나만 볼 수 있는 글로 올라갑니다'}
                . 올린 뒤에는 등록 기록에서 블로그 글을 삭제할 수 있습니다.
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
                  발행하기
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

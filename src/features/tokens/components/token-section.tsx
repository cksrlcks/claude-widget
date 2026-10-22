import { Fragment, useState } from "react"
import { ChevronRight, CircleHelp, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { useTokenUsage } from "@/shared/api/queries"
import { Section } from "@/shared/components/section"
import type { ProjectTokens } from "@/shared/types"

const COLS = "grid grid-cols-[minmax(0,1fr)_48px_60px_64px_56px_60px] items-center gap-x-2"
const NUM_COLS: { label: string; hint: string }[] = [
  { label: "질문", hint: "직접 보낸 질문 수 (명령·도구 결과 제외)" },
  { label: "질문당", hint: "질문 하나에 쓴 토큰" },
  { label: "평균 대비", hint: "질문당 토큰을 내 전체 폴더의 중앙값과 비교" },
  { label: "초과분", hint: "맥락이 10만 토큰을 넘어 매번 다시 읽은 몫" },
  { label: "합계", hint: "입력 + 출력 + 캐시 읽기 + 캐시 쓰기" },
]

type Waste = { label: string; detail: string; tip: string }
type Row = { p: ProjectTokens; perPrompt: number | null; ratio: number | null; extra: number }

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(Math.round(n))
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const total = (p: ProjectTokens) => p.input + p.output + p.cacheRead + p.cacheWrite

/** 평균 대비 배수 색 (3배 이상 빨강, 1.5배 이상 노랑) */
function ratioTone(r: number | null): string {
  if (r === null) return "text-muted-foreground"
  if (r >= 3) return "text-destructive font-semibold"
  if (r >= 1.5) return "text-warning font-semibold"
  return "text-muted-foreground"
}

/** 질문당 토큰을 중앙값과 비교. 정렬은 "평균만큼 썼다면 덜 썼을 양" 순 — 배수 순이면 질문 몇 개짜리 폴더가 위로 튐 */
function toRows(data: ProjectTokens[]): { rows: Row[]; median: number } {
  // 질문 수로 가중한 중앙값 (내 질문의 절반이 이만큼 이하로 처리됨) — 질문 몇 개짜리 폴더가 기준을 흔들지 않게
  const per = data.filter((p) => p.prompts > 0).map((p) => ({ v: total(p) / p.prompts, n: p.prompts }))
  per.sort((a, b) => a.v - b.v)
  const half = per.reduce((a, x) => a + x.n, 0) / 2
  let acc = 0
  const median = per.find((x) => (acc += x.n) >= half)?.v ?? 0
  const rows = data.map((p) => {
    const perPrompt = p.prompts ? total(p) / p.prompts : null
    return {
      p,
      perPrompt,
      ratio: perPrompt !== null && median ? perPrompt / median : null,
      extra: perPrompt !== null ? Math.max(0, total(p) - p.prompts * median) : 0,
    }
  })
  rows.sort((a, b) => b.extra - a.extra || total(b.p) - total(a.p))
  return { rows, median }
}

/** 낭비 신호와 팁. 문구의 10만 토큰·5분·4만 자는 src-tauri/src/tokens.rs 기준값과 맞춤 */
function wastes(p: ProjectTokens): Waste[] {
  const out: Waste[] = []
  const excess = pct(p.excess, total(p))
  if (excess >= 50)
    out.push({
      label: "긴 대화",
      detail: `토큰의 ${excess}%가 맥락 10만을 넘겨 다시 읽은 몫`,
      tip: "요청마다 앞 대화 전체를 다시 읽습니다. 작업이 바뀌면 /clear, 이어가야 하면 /compact로 맥락을 줄이세요.",
    })
  if (p.rewrites >= 5)
    out.push({
      label: "쉬었다 이어가기",
      detail: `5분 넘게 쉰 뒤 맥락을 통째로 다시 캐시한 횟수 ${p.rewrites}회`,
      tip: "쉬는 동안 캐시가 만료돼 맥락 전체를 다시 씁니다. 오래 쉬었다면 /compact 후 이어가거나 새 세션으로 시작하세요.",
    })
  const sub = pct(p.subRequests, p.requests)
  if (sub >= 50)
    out.push({
      label: "서브에이전트",
      detail: `응답의 ${sub}%가 서브에이전트에서 나옴`,
      tip: "서브에이전트는 각자 맥락을 새로 채웁니다. 간단한 검색·확인은 직접 시키고, 병렬 에이전트는 꼭 필요할 때만 쓰세요.",
    })
  if (p.bigOutputs >= 3)
    out.push({
      label: "큰 출력",
      detail: `4만 자 넘는 도구 결과 ${p.bigOutputs}회 (${p.bigTools.map(([n, c]) => `${n} ${c}`).join(", ")})`,
      tip: "한 번 읽은 큰 결과는 대화가 끝날 때까지 매 요청에 실려 갑니다. 파일은 범위를 지정해 읽고, 명령 출력은 grep·head로 줄이세요.",
    })
  if (p.sessions > 0 && p.baseline >= 80_000)
    out.push({
      label: "기본 맥락",
      detail: `세션 시작부터 ${fmt(p.baseline)} 토큰이 깔림 (중앙값)`,
      tip: "MCP 도구 정의·플러그인·스킬·CLAUDE.md가 모든 요청에 붙습니다. 안 쓰는 MCP·플러그인을 끄고 CLAUDE.md를 짧게 유지하세요.",
    })
  return out
}

export function TokenSection() {
  const { data, error, isFetching, refetch } = useTokenUsage()
  const { rows, median } = toRows(data ?? [])

  return (
    <Section
      title="토큰 사용"
      description={`세션을 시작한 폴더별 · 평균보다 많이 쓴 순 · 남은 대화 기록(기본 30일) 기준${data ? ` · 합계 ${fmt(rows.reduce((a, r) => a + total(r.p), 0))}` : ""}`}
      action={
        <Button variant="secondary" size="sm" disabled={isFetching} onClick={() => refetch()}>
          <RefreshCw className={cn(isFetching && "animate-spin")} /> 다시 계산
        </Button>
      }
    >
      {error ? (
        <p className="text-destructive">불러오지 못했습니다: {String(error)}</p>
      ) : !data ? (
        <p className="text-muted-foreground">대화 기록을 읽는 중… 기록이 많으면 몇 초 걸립니다.</p>
      ) : data.length === 0 ? (
        <p className="text-muted-foreground">대화 기록이 없습니다.</p>
      ) : (
        <>
          <HelpPanel median={median} />
          <div className="bg-card overflow-hidden rounded-[10px] border">
            <div className={cn(COLS, "text-muted-foreground border-b px-3.5 py-2 text-[11px]")}>
              <span className="pl-6">폴더</span>
              {NUM_COLS.map((c) => (
                <span key={c.label} title={c.hint} className="cursor-help text-right">
                  {c.label}
                </span>
              ))}
            </div>
            {rows.map((r) => (
              <ProjectRow key={r.p.path} row={r} median={median} />
            ))}
          </div>
        </>
      )}
    </Section>
  )
}

/** 표 보는 법 — 기준값은 wastes()·ratioTone()·src-tauri/src/tokens.rs와 맞춤 */
const HELP: [string, string][] = [
  ["합계", "입력 + 출력 + 캐시 읽기 + 캐시 쓰기. 크면 그 폴더에서 일을 많이 한 것이지 낭비라는 뜻은 아닙니다."],
  ["질문당", "합계 ÷ 직접 보낸 질문 수. 슬래시 명령·도구 결과·대화 요약은 질문으로 세지 않습니다."],
  ["평균 대비", "질문당 토큰 ÷ 내 질문당 중앙값. 같은 일에 몇 배를 썼는지 보여줍니다. ×1.5 이상 노랑, ×3 이상 빨강."],
  ["초과분", "요청마다 맥락이 10만 토큰을 넘은 부분의 비율. 대화를 길게 끌어 앞 내용을 매번 다시 읽은 몫입니다."],
  ["정렬", "내 평균만큼 썼다면 덜 썼을 양이 큰 순. 질문 몇 개짜리 폴더가 배수만으로 위에 오지 않게 합니다."],
  ["폴더", "세션을 시작한 폴더 기준. 세션 중 하위 폴더로 옮기거나 서브에이전트가 돌아도 시작 폴더로 묶습니다."],
]
const BADGES: [string, string][] = [
  ["긴 대화", "토큰의 50% 이상이 초과분"],
  ["쉬었다 이어가기", "5분 넘게 쉰 뒤 캐시를 5만 토큰 이상 다시 쓴 일이 5회 이상"],
  ["서브에이전트", "응답의 50% 이상이 서브에이전트에서 나옴"],
  ["큰 출력", "4만 자 넘는 도구 결과가 3회 이상"],
  ["기본 맥락", "세션 첫 요청의 맥락(MCP·플러그인·CLAUDE.md 등)이 중앙값 8만 토큰 이상"],
]

function HelpPanel({ median }: { median: number }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="bg-card -mt-1 overflow-hidden rounded-[10px] border text-[11.5px]"
    >
      <CollapsibleTrigger className="hover:bg-foreground/3 text-muted-foreground flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left">
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <CircleHelp className="size-3.5 shrink-0" />
        <span className="text-foreground">이 표 보는 법</span>
        <span className="truncate">
          · 합계가 크면 일을 많이 한 것, 평균 대비가 크면 같은 일에 토큰을 더 쓴 것 · 내 질문당 중앙값 {fmt(median)}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 border-t px-3.5 py-3 pl-9.5">
        <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5">
          {HELP.map(([t, d]) => (
            <Fragment key={t}>
              <dt className="font-medium">{t}</dt>
              <dd className="text-muted-foreground">{d}</dd>
            </Fragment>
          ))}
        </dl>
        <div className="grid gap-1.5">
          <p className="font-medium">배지가 붙는 기준</p>
          <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5">
            {BADGES.map(([t, d]) => (
              <Fragment key={t}>
                <dt>
                  <Badge variant="secondary" className="bg-warning/15 text-warning font-normal">
                    {t}
                  </Badge>
                </dt>
                <dd className="text-muted-foreground">{d}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
        <p className="text-muted-foreground">
          배지가 붙은 폴더를 펼치면 원인과 줄이는 방법이 나옵니다. Claude Code는 기본 설정으로 30일 지난 대화 기록을
          지우므로 최근 한 달 정도가 집계됩니다.
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ProjectRow({ row, median }: { row: Row; median: number }) {
  const { p, perPrompt, ratio, extra } = row
  const [open, setOpen] = useState(false)
  const w = wastes(p)
  // 같은 이름 폴더(src, app 등)를 구분하도록 상위 경로를 흐리게 붙임
  const cut = Math.max(p.path.lastIndexOf("\\"), p.path.lastIndexOf("/"))
  const name = p.path.slice(cut + 1) || p.path
  const parent = cut > 0 ? p.path.slice(0, cut) : ""
  const cells = [
    String(p.prompts),
    perPrompt === null ? "-" : fmt(perPrompt),
    ratio === null ? "-" : `×${ratio.toFixed(1)}`,
    `${pct(p.excess, total(p))}%`,
    fmt(total(p)),
  ]

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t first:border-t-0">
      <CollapsibleTrigger className={cn(COLS, "hover:bg-foreground/3 w-full cursor-pointer px-3.5 py-2 text-left")}>
        <div className="flex min-w-0 items-start gap-2" title={p.path}>
          <ChevronRight
            className={cn("text-muted-foreground mt-0.5 size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          />
          <div className="grid min-w-0 gap-1">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 font-medium">{name}</span>
              <span className="text-muted-foreground truncate text-[11px]">{parent}</span>
            </span>
            {w.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {w.map((x) => (
                  <Badge key={x.label} variant="secondary" className="bg-warning/15 text-warning font-normal">
                    {x.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        {cells.map((c, i) => (
          <span
            key={i}
            className={cn(
              "self-start text-right text-xs tabular-nums",
              i === 2 ? ratioTone(ratio) : i === 4 ? "text-muted-foreground" : "",
            )}
          >
            {c}
          </span>
        ))}
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2.5 pr-3.5 pb-3 pl-9.5">
        <div className="text-muted-foreground grid gap-0.5 text-[11px]">
          <p className="truncate" title={p.path}>
            {p.path} · 세션 {p.sessions} · 응답 {p.requests} (서브에이전트 {p.subRequests})
          </p>
          <p>
            입력 {fmt(p.input)} · 출력 {fmt(p.output)} · 캐시 읽기 {fmt(p.cacheRead)} · 캐시 쓰기 {fmt(p.cacheWrite)}
          </p>
        </div>
        {ratio !== null && perPrompt !== null && (
          <p className={cn(ratio >= 1.5 ? "font-medium" : "text-muted-foreground text-xs")}>
            질문 하나에 평균 {fmt(perPrompt)} — 내 평균({fmt(median)})의 {ratio.toFixed(1)}배
            {extra > 0 && `. 평균만큼 썼다면 약 ${fmt(extra)} 덜 썼을 양입니다.`}
          </p>
        )}
        {w.length ? (
          w.map((x) => (
            <div key={x.label} className="grid gap-0.5">
              <p className="font-medium">
                {x.label} <span className="text-muted-foreground font-normal">· {x.detail}</span>
              </p>
              <p className="text-muted-foreground text-xs">{x.tip}</p>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground text-xs">눈에 띄는 낭비 신호가 없습니다.</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

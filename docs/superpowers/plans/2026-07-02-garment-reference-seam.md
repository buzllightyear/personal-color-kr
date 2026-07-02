---
revisions:
  - "2026-07-02 R1: codex review R1 critical/high 8건 반영 — eval 유료실행 승인게이트(INVARIANTS #8)+cell key(garment,seed)+CSV upsert, allowlist 프루닝 별도 배포단계, payload 예약키 정책, admin preview 정합, 빈 garment 422 계약, Alembic 하드코딩 테스트 3곳+실DB 왕복, 신선도 필터 통합티어 검증"
  - "2026-07-02 R2: codex review R2 high 1건 반영 — cell key는 dedupe/join/upsert 전용, aggregation key=(model,knob) 유지 + GARMENT_FLOOR fail-closed (최종 라운드 후 적용, codex 재검증 없음)"
---

# 피봇 마일스톤 1 — 백엔드 seam: 옷 레퍼런스 입력 + 트렌드 레시피 필드 + fal_eval 확장

## Context

STRATEGY.md §6–§10 피봇("내 실제 옷 × 이번 주 operator 트렌드+포맷")의 첫 코딩 마일스톤. §10이 지목한 상류 게이트들: §7-D gap #3(생성 파이프라인에 옷 레퍼런스 입력 없음), gap #1(레시피 신선도 없음), gap #2/§7-E(format_template 없음), fal_eval floor(§7-C·§9-D⑥ 바운디드 의상-충실도 축). **스코프: 백엔드만** (사용자 결정) — 모바일·진단 제거는 다음 마일스톤이므로 옷 입력은 API에서 optional (현 모바일 클라이언트 무중단).

**탐색에서 확인된 기존 결함 (이번에 고침):** 프로덕션 `fal_client`는 `image_url`(단수)를 보내지만 승인된 5개 모델 중 4개(`*_edit`)는 `image_urls[]`(배열)를 받음 — 옷 레퍼런스는 그 배열의 2번째 원소.

## 불변식 대조 (docs/INVARIANTS.md)

- **#1 원본 미저장**: 닿음 — 옷 사진도 동일 규칙: fal 임시 스토리지(생성용 단수명 URL)만, 우리 object storage·DB에 절대 저장 안 함. 설계가 이를 구조로 보장(Task 5 테스트로 핀).
- **#4 prompt_template 유출 금지**: 닿음 — `format_template`도 동일하게 `CatalogRecipeResponse`에서 제외(내부 전용, 테스트로 핀).

## 핵심 설계 결정

- **D1 — `reference_mode: Literal["single","multi"]`를 `FalGenerationConfig`에 추가.** 모델별 payload 키(단수/배열)는 모델-패밀리 속성이므로 allowlist(`approved_models.py`)가 결정, fal_client는 모델-무지 유지. `flux/dev/image-to-image`=single(옷 불가), 나머지 4개 edit 모델=multi.
- **D2 — `GenerationInputs` 값 객체** (`selfie_bytes` + `garment_bytes: bytes|None`): 시그니처 변경은 이번 한 번뿐, 이후 레퍼런스 추가는 객체 확장으로. 옷 업로드는 fal_client 안에서 셀피와 같은 3-step. 30s 예산 로직 무변경(단계별 deadline 클리핑이 이미 처리).
- **D3 — 신선도 = nullable `expires_at` 단일 컬럼.** NULL=에버그린 → 기존 시드 레시피 무변경 동작. 카탈로그 필터 `(expires_at IS NULL OR expires_at > now)`. `POST /v1/generate`는 만료 게이트 안 함(만료=이번 주 트렌드 아님이지 생성 불가 아님 — stale 카탈로그 클라이언트 404 방지).
- **D4 — `format_template` = nullable JSONB 컬럼 + 내부 Pydantic 스키마 검증 지금, 컴포지터는 스트레치.** 한글 오버레이엔 번들 TTF 필요 — **Pretendard 권장**(이미 디자인 시스템 폰트, OFL 라이선스라 사실상 확정 후보).
- **D5 — optional multipart `garment`** (`File(None)`): 구 클라이언트 422 없음. 옷 전송 + single-ref 레시피 → 422 `garment_not_supported`.
- **D6 — 순서: fal_eval 먼저** (프로덕션 코드가 가정하기 전에 멀티-레퍼런스 거동을 모델별 검증). Task 2–5(파이프라인)와 6–7(레시피 필드)은 병렬 가능.

## 태스크 (각각 test-first, 독립 검증 가능)

1. **fal_eval 옷-레퍼런스 확장** — `config.py`: `build_args`에 `garment_url` 파라미터, `_ref_urls` → `image_urls: [selfie, garment?]`, `Model.supports_garment`/`Recipe.needs_garment` 플래그, §10 ii-a 문구의 garment 레시피 2개("first image의 인물이 second image의 옷을 입고 …" + 씬/포맷), 페어링 상한. **canonical cell key = `(model, recipe, variant, knob, selfie, garment, seed)`** — 이 key는 **dedupe/join/upsert 전용**으로 `runs.json`·`results.csv`·`build_report.py`·`summarize.py`의 셀 식별에 관통시키되(현행 join key엔 garment는 물론 seed도 없어 셀 충돌; `summarize.py:63` 참조), **aggregation key는 기존 `(model, knob)` 유지**(집계까지 cell key로 그룹화하면 셀별 점수만 남아 floor·평균·모델 순위가 성립하지 않음). `GARMENT_FLOOR`는 garment-required 셀만 집계하고 미채점 셀이 있으면 fail-closed. `run_matrix.py`: garment 업로드 캐시 + 출력 경로에 garment 축. `build_report.py`: 기존 `results.csv` 통째-보존을 **cell-key 기반 merge/upsert로 교체**(현행은 stage 확장 후 새 셀이 채점표에 안 들어감) + garment_fidelity 사람-채점 컬럼(바운디드 루브릭: 카테고리·색·패턴·핏 보존, 픽셀 SKU-매칭 아님) + 입력 옷 썸네일. `summarize.py`: GARMENT_FLOOR 게이트. **운영자 승인 게이트(INVARIANTS #8, 유료 API 실행 전 필수)**: 드라이런·풀 매트릭스 실행 전에 예상 셀 수 × 모델별 단가로 최대 비용을 산출해 운영자 확인을 받는다(사진 준비·모델 확정은 승인을 대체하지 않음). 승인 후 1셀 드라이런 → 풀 매트릭스 → **모델 선정**. **`APPROVED_EDIT_MODELS` 프루닝은 별도 배포 단계(후속 미니 태스크)로 분리**: `generate.py`가 allowlist에서 빠진 모델을 쓰는 published recipe를 즉시 503 처리하므로, ① 기존 published recipe 인벤토리 → ② 승자 모델로 재지정 → ③ 실생성 스모크 성공 확인 후에만 프루닝을 배포한다(순서 역전 시 구 모바일 클라이언트 정상 요청이 깨짐).
2. **core-python fal_client** — `GenerationInputs`(frozen, `__post_init__` 검증) + `reference_mode` + `_upload_selfie`→`_upload_image` 리네임 + 순수 `_build_model_payload(config, image_urls) -> dict` 헬퍼 + `generate_from_recipe(config, inputs, ...)`. **예약 키 정책**: 현행 구현은 기준 payload 뒤에 `payload.update(config.parameters)`를 수행하므로(`fal_client.py:325`) `parameters`가 `prompt`/`image_url`/`image_urls`를 덮어써 garment가 조용히 무시될 수 있음 — `RESERVED_PAYLOAD_KEYS = {"prompt", "image_url", "image_urls"}`를 정의하고 `parameters`에 예약 키가 있으면 HTTP 전 거절(ValueError→상류 매핑), 최종 payload에 reference 키가 **정확히 하나만**(`image_url` xor `image_urls`) 존재함을 테스트로 핀. 테스트(기존 MockTransport 패턴): single 무-옷=오늘 payload 그대로(회귀 핀) / multi 무-옷=`image_urls:[selfie]` / multi+옷=업로드 2회+`[selfie,garment]` 순서 / single+옷=HTTP 전 ValueError / 예약 키 충돌 거절 / 옷 업로드 실패 매핑(429·5xx retryable, 4xx non-retryable).
3. **core-python orchestrator** — `orchestrate_generation(config, inputs, ...)`·`GenerateFn` 시그니처, 재시도마다 동일 `GenerationInputs` 전달 단언. 리젝션·워터마크 무변경.
4. **apps/api 의존성** — 신규 `dependencies/garment_validation.py`(`validate_optional_garment_upload -> bytes|None`, 셀피 검증 재사용: 415/413 동일 계약; **빈 파일 계약 고정**: 현행 validator는 MIME·최대 크기만 검사해 0바이트를 통과시키는데(`selfie_validation.py:122`), garment part가 존재하되 0바이트면 **422로 거절** — `GenerationInputs.__post_init__`의 ValueError는 방어선일 뿐이며 핸들러 예외 매핑에 없어 500이 되므로 라우트에 도달하지 않음을 테스트로 핀), `approved_models.py`에 `MULTI_REFERENCE_EDIT_MODELS` + `reference_mode_for()`(allowlist 전수 커버 테스트 — 모드 없는 모델 추가 시 실패), `GenerateRunner` alias 확장. **admin preview 정합**: `fal_preview_caller.py`는 별도 payload builder로 `image_url`(단수)만 보내므로(215행) production seam과 재분기 — preview도 `reference_mode_for()` 기반 공통 payload 규칙(단수/배열 스위치)을 타도록 수정하고, 만약 이번 스코프에서 제외하면 "알려진 비호환"으로 리스크 섹션에 명시.
5. **apps/api 핸들러** — `garment_bytes` 파라미터, `garment_not_supported` 422 가드, `_build_config`에 `reference_mode`, `runner(config, GenerationInputs(...))`. 테스트: **하위호환 핀**(recipe_id+selfie만 → 200 + garment_bytes=None), 옷+multi → 200, 옷+single → 422+runner 미호출, zero-PII 핀(persist는 워터마크 결과만 — 기존 단언 유지).
6. **DB 마이그레이션** — `versions/2026_07_02_0000-trend_recipe_freshness_….py`: `expires_at`(timestamptz nullable) + `format_template`(JSONB nullable), `down_revision="content_gen_recipe_meta"`. 모델에 `Mapped` 필드 2개. **하드코딩 테스트 3곳 같은 태스크에서 갱신**: ① `test_alembic_history_chain.py`(head id·리비전 수 7→8), ② `tests/unit/test_alembic_baseline_revision.py`(migration **파일 목록**을 정확히 고정 — 새 파일 추가 시 실패, 100행 부근), ③ `tests/integration/test_events_migration.py`(head를 `content_gen_recipe_meta`로 고정, 66행 부근). **실DB 마이그레이션 통합 테스트 추가**: `upgrade head → 두 컬럼 존재·타입(timestamptz/JSONB)·nullable 확인 → downgrade → re-upgrade` 왕복이 실 Postgres에서 성공함을 핀.
7. **admin + 카탈로그** — `FormatTemplate` 내부 스키마(`version:1, kind:"text_overlay", text, position, …` — 필드 검증), `RecipeCreate/Update/Response`에 두 필드(+명시적 null-clear 패턴), 카탈로그 쿼리에 신선도 필터(컬럼 연산자만 — AC11 유지), `CatalogRecipeResponse`엔 `expires_at`만 추가·`format_template` 제외 단언. 만료 레시피 제외/에버그린 포함 테스트은 **unit stub만으로는 불충분** — 현행 catalog unit stub은 단순 `column == value`만 해석하고 복합 `(expires_at IS NULL OR expires_at > now)` 조건을 사실상 무시하므로(`test_recipes_catalog.py:118`) 쿼리가 틀려도 unit이 통과함. 만료 제외·에버그린 포함·경계 근처 케이스를 **통합 티어(실 Postgres)에서** 시드 데이터로 검증하는 테스트를 반드시 추가.
8. **(스트레치, 폰트 확정 게이트)** — `format_overlay.py`(watermark.py 모델링, Pillow): `apply_format_overlay(image_bytes, template) -> bytes`, 워터마크 뒤 적용. 미착수 시에도 컬럼+검증은 출고(operator가 템플릿 저작 시작 가능).

## Verification

```bash
cd packages/core-python && python -m pytest -q && python -m black --check src tests && python -m ruff check src tests && python -m mypy --strict src
cd apps/api && python -m pytest -q && python -m black --check src tests && python -m ruff check src tests && python -m mypy --strict src
# 통합 티어(로컬 Postgres): docker-compose up -d postgres 후 integration 마커 + alembic upgrade head
python -m pytest -q tests/test_diff_no_new_runtime_deps.py   # AC19: 새 dep 0
# fal_eval (FAL_KEY, 셀피·옷 사진 준비됨): 1셀 드라이런 → run_matrix → build_report → 사람 채점 → summarize
```

모바일 무변경 확인: `pnpm --filter mobile run typecheck && test` (변화 없어야 정상).

## 리스크 / 운영자 결정 (남는 것)

1. **live payload 변경**: 4개 `*_edit` 모델이 `image_url`→`image_urls[]`로 바뀜(검증된 결함 수정이지만 실거동 미확인) — Task 5 머지 후 실제 생성 1회 스모크.
2. **운영자 입력 필요**: (a) eval용 옷 사진 세트 — §10-A상 *입고 찍은 컷*이 핏 정보를 담으므로 행거샷+착용샷 둘 다 소량 권장; (b) eval 후 승자 모델 확정; (c) Task 8 폰트 = Pretendard 확인만.
3. PR 프로세스: 태스크 단위 커밋, CI(4중 게이트) 통과 후 PR — main 보호 규칙 준수. 계류 중인 PR #122(전략 문서)는 CI 통과 상태라 먼저 머지.

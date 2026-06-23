## Round 1 (2026-06-23T17:10:32+09:00)

_severity:_ critical=0 high=6 medium=4  _turn:_ completed

파일을 먼저 읽고, 근처 계획/테스트 구조도 같이 확인해서 플랜의 주장과 프로젝트 실제 위치가 맞는지 대조하겠습니다.

플랜 전반이 꽤 구체적이라, 지금은 각 Task가 실제 코드 구조와 충돌하는 지점을 좁혀 보고 있습니다. 특히 migration/test pin, schema validation, web/mobile 타입 경계는 계획 문구만으로는 놓치기 쉬운 부분이라 실제 파일 기준으로 확인합니다.

지금 확인한 바로는 플랜이 “전체 경로”는 잡고 있지만, 업데이트 의미론과 검증 책임이 몇 군데 모호합니다. 계속 실제 테스트 helper와 web form 구현을 봐서 누락이 단순 문구인지 실행 차원의 결함인지 가르겠습니다.

실제 파일 대조는 충분합니다. 결론은 “구현 순서 자체”보다, API update에서 null을 지우지 못하게 만드는 계획과 thumbnail_url 공개 HTTPS 검증 누락이 가장 큰 리스크입니다.

### Critical
- (없음)

### High
- **Alembic chain test 수정 범위가 불완전하다.** 근거: 플랜은 head/length만 `6→7`로 바꾸라고 한다([plan:82](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:82)). 하지만 실제 `test_alembic_history_chain.py`는 `walk`를 6개 변수로 destructure하고, 첫 항목이 `_GENERATIONS_REVISION_ID`라고 고정한다([test_alembic_history_chain.py:190](/Users/opty/Code/personal-color-kr/apps/api/tests/unit/test_alembic_history_chain.py:190), [test_alembic_history_chain.py:199](/Users/opty/Code/personal-color-kr/apps/api/tests/unit/test_alembic_history_chain.py:199)). 새 migration 추가 후 이 테스트는 `len=7`을 통과해도 destructure/assert에서 깨진다. baseline AST test도 새 revision이 `content_gen_generations`에 chain 되는지 확인하는 테스트를 추가하지 않는다.
- **nullable metadata를 update로 지울 수 없다.** 근거: 플랜은 `description`/`thumbnail_url`을 nullable로 정의하고 web form에서 빈 문자열을 `null`로 보낸다([plan:676](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:676), [plan:684](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:684)). 그런데 router update는 `if body.description is not None` / `if body.thumbnail_url is not None` 가드로 `null`을 무시한다([plan:362](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:362)). self-review가 이를 “Acceptable”로 합리화하지만([plan:803](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:803)), “admin: full CRUD”와 충돌한다.
- **`thumbnail_url`의 public HTTPS 검증이 없다.** 근거: 전역 제약은 “public HTTPS URL”이라고 못박는다([plan:14](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:14)). 그러나 schema는 단순 `str | None`이고([plan:323](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:323)), web input도 plain text다([plan:731](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:731)). `http://`, relative path, storage key, presigned URL 같은 실패 케이스를 막는 테스트도 없다.
- **기존 row backfill이 semantic required title을 깨뜨린다.** 근거: migration/model은 `title` NOT NULL을 위해 `server_default=''`를 쓴다([plan:119](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:119), [plan:194](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:194)). 새 create는 `min_length=1`인데 기존 published row는 빈 title로 catalog에 노출될 수 있다. NOT NULL backfill은 만족하지만 display metadata 요구의 “required title” 의미는 만족하지 않는다.
- **모바일 catalog UI가 metadata를 렌더하지 않는다.** 근거: 목표는 “catalog can render attractive Meitu-style cards”다([plan:5](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:5)), 전역 제약은 thumbnail absent 시 placeholder를 말한다([plan:14](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:14)). 하지만 Task 4는 `fetch-recipe-catalog.ts` projection만 수정하고([plan:460](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:460)), 실제 `RecipeCatalogScreen`은 현재 `recipe.recipeId`만 표시한다([RecipeCatalogScreen.tsx:148](/Users/opty/Code/personal-color-kr/apps/mobile/src/screens/generate/RecipeCatalogScreen.tsx:148)). placeholder/image/title/tag 렌더링 범위가 빠졌다.
- **web `Recipe` 타입 변경 후 test fixture 업데이트가 빠져 typecheck가 깨진다.** 근거: 플랜은 `Recipe`에 required `title`, `description`, `tags`, `thumbnail_url`을 추가한다([plan:640](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:640)). 실제 `RecipeForm.test.tsx`의 `makeRecipe()`는 해당 필드가 없다([RecipeForm.test.tsx:26](/Users/opty/Code/personal-color-kr/apps/web/tests/admin/RecipeForm.test.tsx:26)). Task 5는 label assertion만 언급하고 fixture 보강을 빠뜨렸다.

### Medium
- **web 검증이 label 존재에 치우쳐 payload correctness를 보장하지 않는다.** 근거: Task 5 test는 label assertion만 추가한다([plan:622](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:622)). create/update payload에 title이 들어가는지, tags comma parsing, 빈 description/thumbnail의 `null` 변환, HTTPS invalid case는 검증하지 않는다.
- **`exactOptionalPropertyTypes` 지침과 update payload 방식이 느슨하게 충돌한다.** 근거: 전역 제약은 “conditionally spread optional props”라고 한다([plan:16](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:16)). 하지만 Task 5는 `RecipeUpdate` body에 새 optional 필드를 항상 넣는다([plan:680](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:680)). `undefined`는 피하지만, “optional update” 의미와 검증 기준이 불명확하다.
- **line/helper 정확성에 copy-paste 위험이 있다.** 근거: 플랜의 새 admin test snippet은 `_build_admin_app`, `_ADMIN_URL`, `_ADMIN_HEADERS`를 쓰지만 실제 파일은 `_build_app_with_stub` 패턴이다; 플랜이 단서로 “이름이 다르면 맞춰라”라고 쓰긴 했지만([plan:306](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:306)), 바로 실행 가능한 계획으로는 약하다. 또한 create test 위치도 “~line 268”이라고 하지만 실제 create endpoint test는 467 근처다([test_admin_recipes.py:467](/Users/opty/Code/personal-color-kr/apps/api/tests/unit/test_admin_recipes.py:467)).
- **pytest pin 전제가 실제 파일과 불일치한다.** 근거: 플랜은 `pytest pinned <9.1`이라고 한다([plan:18](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:18)). 현재 `apps/api/pyproject.toml`은 `pytest>=9.1.1`로 보인다([pyproject.toml:208](/Users/opty/Code/personal-color-kr/apps/api/pyproject.toml:208)). 이 상태면 “pytest<9.1” gotcha를 plan만으로 검증했다고 볼 수 없다.

### 권장 수정
- Alembic task에 `walk` destructuring을 7개로 바꾸고, `recipe_meta_script.revision == _RECIPE_META_REVISION_ID`, `recipe_meta_script.down_revision == _GENERATIONS_REVISION_ID`, generations가 두 번째가 되는 assert까지 명시하라. baseline AST test에도 새 migration revision/down_revision 검사를 추가하라.
- `RecipeUpdate`는 field presence를 구분하게 바꾸라. Pydantic v2라면 `body.model_fields_set` 기준으로 `null`이 명시된 경우 `description`/`thumbnail_url`을 실제로 `None`으로 저장한다.
- `thumbnail_url`은 API schema에서 HTTPS만 허용하고, `http://`, relative URL, storage key, empty string 실패 테스트를 추가하라. web은 submit 전 trim 후 빈 값은 `null`, 값이 있으면 HTTPS URL만 허용하도록 맞춰라.
- 기존 row backfill은 `''` 대신 `recipe_id` 기반 title 등 의미 있는 값으로 채우거나, 최소한 migration/integration test에서 existing published row가 빈 title로 노출되지 않음을 검증하라.
- 모바일 scope를 명확히 하라. “projection only”가 의도면 목표 문구에서 렌더링을 빼고, 아니라면 `RecipeCatalogScreen`과 tests에 title/description/tags/thumbnail/placeholder 렌더링을 포함하라.
- web/admin/mobile tests에 payload 및 failure-case assertions를 추가하라. 특히 create/update payload, null clearing, tags parsing, invalid thumbnail, public catalog field values를 검증해야 한다.

---


<!-- codex-reviewer audit WARN: R1->R2 applied +96 lines vs threshold 90 (6 HIGH x 15). Excess +6 lines, justified by new mobile card-render Task 4 step. Applied. -->
## Round 2 (2026-06-23T17:16:46+09:00)

_severity:_ critical=0 high=1 medium=6  _turn:_ completed

현재 파일을 다시 읽고 R1의 high 항목들이 실제 v2 본문에서 닫혔는지만 좁게 대조하겠습니다. 이전 라운드 본문은 참고 기준으로만 쓰고, 사실 판단은 파일 시스템의 현재 내용에 맞추겠습니다.

v2 본문을 확인했습니다. R1 항목 대부분은 닫혔지만, Alembic walk 순서 수정 지시가 실제 Alembic `walk_revisions()` 방향과 반대로 적힌 부분이 남아 있어 실행 실패 위험으로 봅니다.

추가로 실제 모바일 테스트 파일 이름을 대조했습니다. v2가 “existing screen test”라는 완충 문구를 넣어서 큰 리스크는 아니지만, 파일 표와 commit path는 실제 lowercase 파일명과 어긋납니다.

### Critical
- (없음)

### High
- **Residual — R1 Alembic chain 수정이 아직 정확히 닫히지 않았다.** v2는 `walk`가 7개가 되도록 하라고 했지만 새 변수를 “now-last” `recipe_meta_script`로 추가하라고 지시한다([plan:91](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:91)) and `generations`를 “second-to-last”라고 설명한다([plan:99](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:99)). 실제 테스트는 `walk_revisions()`가 **head → base** 순서라고 명시하고([test_alembic_history_chain.py:163](/Users/opty/Code/personal-color-kr/apps/api/tests/unit/test_alembic_history_chain.py:163)), 첫 번째 변수를 현재 head로 assert한다([test_alembic_history_chain.py:190](/Users/opty/Code/personal-color-kr/apps/api/tests/unit/test_alembic_history_chain.py:190), [test_alembic_history_chain.py:199](/Users/opty/Code/personal-color-kr/apps/api/tests/unit/test_alembic_history_chain.py:199)). 새 migration은 “first/new head”가 되어야 하므로, 이 지시를 문자 그대로 따르면 unit test가 깨진다.

### Medium
- **Closed — R1 null-clearing.** v2는 `description`/`thumbnail_url` update를 `body.model_fields_set` presence로 gate하고, explicit `null` clearing과 omitted unchanged 테스트를 추가하라고 한다([plan:420](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:420), [plan:437](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:437)).
- **Closed with residual medium — R1 thumbnail_url 검증.** non-HTTPS, relative path, storage key, empty string은 API test 대상이 됐다([plan:372](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:372), [plan:396](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:396)). 다만 validator는 `startswith("https://")`뿐이라([plan:386](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:386)) `https://` 같은 비정상 URL이나 presigned HTTPS URL은 “public/no presigned” 제약([plan:17](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:17))까지는 보장하지 못한다.
- **Closed — R1 기존 row title backfill.** migration이 transient default로 column 추가 후 `recipe_id`로 backfill하고 default를 drop한다([plan:211](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:211), [plan:228](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:228), [plan:231](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:231)).
- **Closed — R1 mobile render gap.** v2가 `RecipeCatalogScreen.tsx` 렌더링 step을 추가해 title/description/tags/thumbnail/placeholder를 요구한다([plan:666](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:666), [plan:670](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:670)).
- **Closed — R1 web fixture/typecheck gap.** v2가 `makeRecipe()` fixture에 새 required fields를 추가하라고 명시한다([plan:707](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:707), [plan:710](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:710)).
- **새 medium 위험 — 모바일 테스트 파일 경로 casing이 실제와 다르다.** plan table/commit은 `apps/mobile/tests/RecipeCatalogScreen.test.tsx`를 가리킨다([plan:44](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:44), [plan:688](/Users/opty/Code/personal-color-kr/docs/superpowers/plans/2026-06-23-recipe-display-metadata.md:688)). 실제 파일은 `apps/mobile/tests/recipe-catalog-screen.test.tsx`다. Step 5의 “or the existing screen test” 문구가 있어 high는 아니지만, 중복 테스트 파일 생성 위험이 있다.

### 권장 수정
- Alembic walk 지시를 `recipe_meta_script`가 **첫 번째**가 되도록 고쳐라: `(recipe_meta_script, generations_script, recipes_script, referrals_script, users_script, events_script, base_script) = walk`.
- “now-last / second-to-last” 표현을 제거하고 “new head / second item”으로 바꿔라.
- thumbnail validator는 최소 `AnyUrl`/`HttpUrl` 계열 또는 `urllib.parse`로 scheme+netloc을 확인하고, `https://` 단독 값을 테스트에 추가하라.
- 모바일 테스트 경로를 실제 `apps/mobile/tests/recipe-catalog-screen.test.tsx`로 정정하라.

---


<!-- codex-reviewer audit WARN: R2->R3 applied +19 lines vs threshold 15 (1 HIGH x 15). Excess +4, includes R2 medium hardening (urlparse validator, test-path casing). Applied. -->
## Round 3 (2026-06-23T17:19:55+09:00)

_severity:_ critical=0 high=0 medium=0  _turn:_ completed

현재 파일만 다시 읽고 R2의 high 항목, 즉 Alembic walk 순서 지시가 실제 head→base 방향으로 고쳐졌는지 확인하겠습니다.

### Verdict
- PASS

---


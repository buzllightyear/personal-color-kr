# App Store 카테고리 (Categories) — ko-KR

> iOS App Store Connect의 **앱 카테고리(기본/보조)** 선택 값이에요.
> 카테고리는 한국어 카피가 아니라 Apple이 제공하는 **고정 카테고리 목록에서 선택**하는 드롭다운 값이라, 글자 수 제한이 아니라 "Apple 카테고리 enum 중 1개"라는 제약을 따라요.
> 로케일: `ko-KR` · 플랫폼: iOS App Store 전용

---

## 메타데이터

| 항목 | 값 |
| --- | --- |
| 필드 (App Store Connect) | App 정보 → 카테고리 (기본 / 보조) |
| 로케일 | ko-KR (카테고리 자체는 로케일 공통, 표시 명칭만 현지화됨) |
| 선택 방식 | Apple 고정 카테고리 목록에서 드롭다운 선택 (자유 입력 불가) |
| 문자 제한 (Apple) | 해당 없음 — enum 선택값이라 글자 수 제한 없음 |
| 어조 (brand voice) | 해당 없음 — 선택값(드롭다운). 단, 본 문서의 설명/근거 카피는 해요체 |

> ⚠️ **iOS에는 "뷰티(Beauty)" 단독 카테고리가 없어요.** (그건 Google Play 분류예요.)
> 따라서 셀카·편집 성격은 **사진 및 비디오** 보조 카테고리로 표현했어요.

---

## 최종 선택 (publish-ready)

| 구분 | App Store 카테고리 (ko-KR 표시명) | Apple 카테고리 식별자 (영문) |
| --- | --- | --- |
| **기본 (Primary)** | **라이프스타일** | **Lifestyle** |
| **보조 (Secondary)** | **사진 및 비디오** | **Photo & Video** |

> App Store Connect에서는 보조 카테고리 선택이 선택 사항이지만, ASO 노출 확대를 위해 **반드시 보조 카테고리까지 채워서** 제출하는 것을 권장해요.

---

## 선택 근거 (codebase derivation)

카테고리 선택은 기존 코드베이스의 기능 어휘에서 직접 도출했어요. 새로 지어낸 포지셔닝이 아니에요.

### 기본 카테고리 — 라이프스타일 (Lifestyle)

| 근거 | 출처 (소스) |
| --- | --- |
| 퍼스널 컬러로 **메이크업·코디·맞춤 편집**까지 일상 스타일을 큐레이션 | `screens.ts` — `result_reveal.subhead` "어울리는 메이크업·코디 + 맞춤 편집 결과" |
| **매월 새 스타일 자동 업데이트 / 큐레이션 매거진** = 지속형 라이프스타일 서비스 | `screens.ts` — `value_props.metadata.valueProps` `monthly_curated_magazine`, `value_props.bodyCopy` "큐레이션은 매월 매거진으로" |
| **봄·여름·가을·겨울 4계절 퍼스널 컬러** 진단을 일상 뷰티/스타일 가이드로 제공 | `screens.ts` — `welcome_hook.subhead` "봄·여름·가을·겨울 카테고리부터 맞춤 편집까지" |

> 퍼스널 컬러 진단은 **외모·뷰티·일상 스타일 큐레이션** 도메인이라, iOS 카테고리 체계에서 가장 정확한 상위 분류는 **라이프스타일**이에요. (Seed에서 기본 카테고리를 Lifestyle로 고정)

### 보조 카테고리 — 사진 및 비디오 (Photo & Video)

| 근거 | 출처 (소스) |
| --- | --- |
| 진입·핵심 인터랙션이 **셀카(사진) 1장 업로드** | `screens.ts` — `diagnosis_input.headline` "셀카 1장만 올려주세요", `diagnosis_input.metadata.requiredInputs` `['selfie_image']` |
| 셀카 위에서 **24개 포인트 얼굴 스캔 오버레이** 시각 처리 | `screens.ts` — `fake_scan_animation.subhead` "셀카 위에서 스캔 라인이 24개 포인트를 짚어내고 있어요", `metadata.animationMechanism` `face_scan_overlay` |
| 컬러 매칭 기반 **트렌드 preset 자동 편집 / preset 라이브러리** | `screens.ts` — `value_props.metadata.valueProps` `trend_matched_editing`, `personal_color_preset_library` |
| 핵심 타깃인 **20–30대 셀카 사용자**가 사진 앱 카테고리에서 탐색하는 행동 패턴과 일치 | Seed target audience: 20–30대 한국 여성 셀카 사용자 |

> 셀카 업로드 + 얼굴 스캔 오버레이 + preset 편집은 **사진 처리** 성격이 강해, 보조 카테고리로 **사진 및 비디오**가 가장 적합해요.

- **value_prop (기본)**: 일상 스타일 큐레이션 (라이프스타일)
- **value_prop (보조)**: 셀카 기반 사진 진단·편집 (사진 및 비디오)
- **narrative_position**: `welcome_hook` → `diagnosis_input` → `fake_scan_animation` → `result_reveal` 전반에 걸친 도메인을 카테고리 2종으로 매핑

---

## 보조 카테고리 대체 후보 (참고용)

보조 카테고리를 조정해야 할 경우, 아래 후보 중에서만 선택해 코드베이스 도출 원칙을 유지해 주세요. **기본 카테고리(라이프스타일)는 Seed 고정값이라 변경 대상이 아니에요.**

| 후보 (ko-KR 표시명 / 영문 식별자) | 코드베이스 근거 | 비고 |
| --- | --- | --- |
| **사진 및 비디오 / Photo & Video** | 셀카 업로드 · 얼굴 스캔 오버레이 · preset 편집 | **채택(secondary)** — 셀카+편집 핵심 행동 직접 반영 |
| 건강 및 피트니스 / Health & Fitness | 피부 톤·명도·채도 분석(`fake_loader.subhead`) | 뷰티/외모 관리 인접 카테고리지만 사진 행동성 약함 |
| 엔터테인먼트 / Entertainment | 트렌드 매거진·큐레이션(`value_props`) | 큐레이션 콘텐츠 측면. 다만 진단 도구 성격과 거리 있음 |

> iOS App Store에는 "뷰티" 단독 카테고리가 없으므로, 뷰티 성격은 위 후보로 대체 표현해야 해요.

---

## 어조 검증 (해요체)

- 본 문서의 카테고리 **선택값** 자체(라이프스타일/사진 및 비디오)는 Apple 고정 명칭이라 어조 대상이 아니에요.
- 설명·근거 카피(`~권장해요`, `~적합해요`, `~유지해 주세요`)는 모두 해요체로 작성했어요. ✅
- 반말(예: `적합해`) 아님 ✅ · 존댓말(예: `적합합니다`) 아님 ✅
- 기존 메타데이터 문서(`title.md`, `subtitle.md`)와 동일한 해요체 레지스터 유지 ✅

---

## TODO (제출 전 사람 확인 필요)

- [ ] **TODO**: App Store Connect → App 정보에서 기본 카테고리 **라이프스타일(Lifestyle)**, 보조 카테고리 **사진 및 비디오(Photo & Video)** 가 실제 드롭다운 선택값으로 저장됐는지 확인 (Apple Developer 계정 접근 필요)
- [ ] **TODO**: 출시 후 ASO 성과 측정 시, 보조 카테고리를 위 대체 후보로 A/B 검토할지 마케팅 담당자 판단 필요

> 위 두 항목 외에는 추가 작성이 필요 없는 publish-ready 상태예요. 카테고리는 코드 변경 없이 App Store Connect 설정만으로 적용돼요.

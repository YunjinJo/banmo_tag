// tests/unit/symbols.test.js — extension/shared/ 의 함수·상수가 모두 로드되는지 (파일을 빠뜨리거나 이름이 바뀐 경우)
// tests/test-runner.html 이 불러옵니다 (describe · it · assert… 도 거기에 있음). 실행 방법은 tests/unit/README.md

describe('공통 코드(shared/*.js) 심볼 무결성 검증', () => {
  // shared/ 에 함수나 상수를 새로 만들면 여기에도 적습니다 (빠진 함수는 `node scripts/validate.js` 가 알려 줍니다).
  // 이름을 바꾸거나 지웠는데 여기에 남아 있으면 "… is not defined" 로 실패합니다.
  it('필수 공유 함수 및 상수가 전역 스코프에 정상 로드됨', () => {
    const functionsByFile = {
      'base.js': [
        debounce, mergeHandles, isHexColor, isValidMode, getHandleFromProfileHref, getBrowserKind, parseHandles
      ],
      'list-names.js': [
        isSystemListName, isValidListName, cleanListName, isFallbackListName, getManualListNameError
      ],
      'list-data.js': [
        sanitizeListsObject, resolveListKey, moveRenamedList, prepareIncomingMembers, prepareListEntry,
        mergeManualMembers, applyListSave, applyListReplace, canAutoRemoveMembers, applyManualAdd, renameList,
        removeMemberFromLists
      ],
      'list-page.js': [
        parseListUrl, getActiveTabText, getScrapeBlockReason, getSyncTabError, getMemberListDialog,
        firstValidCleanName, isRecommendationTitle, getListNameFromPage, isRecoLabel, getPrecedingSectionHeading,
        getLastHeadingBefore, isExcludedUserCell, getHandleFromUserCell, getCellOffsetY, getVisibleBounds,
        readMemberListWindow, trackMemberListProgress, findMemberListScroller, getAutoScanStep, nextAutoScanStep,
        extractMembersFromContainer, buildScrapeSignature
      ],
      'badges.js': [
        buildHandleMap, diffHandleMaps, isTweetAffected, applyBadgeStyle, normalizeListStyle,
        getEffectiveBadgeSettings, normalizeBadgeSettings, setListStyle, clearAllListStyles, countListsWithStyle,
        normalizeFontName, getFontNameFromFamily, buildFontFamily, isValidFontFamily, isCustomFontFamily, getFontLabel,
        isFontLikelyInstalled, getLocalFontFamilies,
        getBadgeAnchor, splitTimelineBadges, getHandleFromUserInfo, addBadges, resetTweetStyle, renderTweet,
        isOwnInjectedNode
      ],
      'backup.js': [
        buildBackup, parseBackup, normalizeImportedLists, mergeImportedLists
      ],
      'health.js': [
        countProfileLinks, diagnoseStructure, diagnoseMembersView, diagnoseTimeline, getStructureWarnings
      ],
      'ui.js': [
        normalizeUiSettings, sortListNames, summarizeMembers
      ]
    };
    Object.keys(functionsByFile).forEach((file) => {
      functionsByFile[file].forEach((fn, i) => assertEqual(typeof fn, 'function', `shared/${file} 의 ${i + 1}번째`));
    });

    const constants = [
      AG_DEFAULT_BADGE_SETTINGS, AG_DEFAULT_LIST_COLOR, AG_VALID_MODES, AG_HANDLE_RE, AG_HEX_COLOR_RE,
      AG_PROFILE_HREF_RE, AG_SYSTEM_LIST_NAMES, AG_SYSTEM_NAME_WITH_PUNCT_RE, AG_LIST_NAME_CLEANUP_RULES,
      AG_MEMBER_TAB_NAMES, AG_SUGGESTED_TAB_NAMES, AG_NON_USER_LIST_PATHS, AG_MEMBER_LINK_IGNORE, AG_RECO_LABELS,
      AG_X_URL_RE, AG_HEADING_SELECTOR, AG_LIST_NAME_SOURCES, AG_AUTO_SCAN_DEFAULTS, AG_FONT_FAMILIES, AG_FONT_LABELS, AG_LIST_STYLE_KEYS,
      AG_TWEET_SELECTOR, AG_USER_NAME_SELECTOR, AG_TIMELINE_MAX_BADGES, AG_DIM_TARGET_SELECTOR, AG_BACKUP_APP,
      AG_HEALTH_AREA_LABELS, AG_NAV_PATHS, AG_THEMES, AG_LIST_SORTS, AG_MODE_LABELS, AG_SWATCH_COLORS
    ];
    constants.forEach((value, i) => assert(value !== undefined && value !== null, `${i + 1}번째 상수`));
    assertEqual(typeof AG_DEFAULT_BADGE_SETTINGS, 'object');
    assert(AG_HANDLE_RE instanceof RegExp, 'AG_HANDLE_RE 정규식 상수가 존재해야 함');
  });
});

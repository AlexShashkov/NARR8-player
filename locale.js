// Text for the player interface. The languages packaged in episode zips are independent.
var NarrLocale = (function () {
  "use strict";

  var messages = {
    en: {
      tagline: "where stories come alive and never end",
      theme: "Theme", classic: "Classic", modern: "Modern", interfaceLanguage: "Interface language",
      changeFolder: "Change folder…", selectFolder: "Select your comics folder",
      pickIntro: "Pick the folder that holds your NARR8 episodes. The player finds series folders, episode",
      pickAfterExtension: "files and covers automatically. Everything stays on your device.",
      folderExample: "Example folder layout", chooseFolder: "Select comics folder…",
      filePrompt: "Can't pick folders on this device?", selectFiles: "Select episode files instead",
      welcomeBack: "Welcome back", reconnectIntro: "Allow the player to read your comics folder",
      reconnectOutro: "again.", openFolder: "Open folder", anotherFolder: "Choose another folder…",
      opening: "Opening folder…", scanning: "Reading episodes…", comics: "Comics", selectedFiles: "Selected files",
      keys: "Keys:", nextKey: "next", previousKey: "previous", contentsKey: "contents",
      menuKey: "menu", fullscreenKey: "fullscreen", spaceKey: "Space",
      episode: "Episode", episodeTitle: "Episode {number}", menu: "Menu", close: "Close",
      continueReading: "Continue", contents: "Contents", restart: "Start over", fullscreen: "Fullscreen",
      exitFullscreen: "Exit fullscreen", episodeLanguage: "Episode language", defaultLanguage: "Default",
      backToLibrary: "Back to library", endOfEpisode: "End of episode", endTitleTop: "End of",
      endTitleBottom: "episode", lastPage: "Back to the last page", nextEpisode: "Next episode ›",
      replay: "Replay", library: "Library", onGitHub: "on GitHub", openSource: "Restored motion comics, open source",
      featured: "Featured episodes", recent: "Latest episodes", seriesShelf: "Series", expand: "Expand", collapse: "Collapse",
      empty: "No NARR8 episode zips were found in “{folder}”. Choose the folder that contains them.",
      progress: "Page {page} of {last}", resumeEpisode: "Resume: {title}", continueEpisode: "Continue: {title}",
      startEpisode: "Start: {title}", unreadable: "Unreadable", cover: "Cover", end: "END",
      next: "Next: {title}", tapToPlay: "Tap to play",
      unsupported: "The player needs a browser with Service Worker support and a page opened over HTTPS or localhost.",
      workerError: "Could not start the player.", folderError: "Could not read the folder.",
      pickerError: "Could not select the folder.", unreadableError: "This episode could not be read.",
      engineError: "The episode's engine failed to start."
    },
    ru: {
      tagline: "мир удивительных историй",
      theme: "Тема", classic: "Классическая", modern: "Современная", interfaceLanguage: "Язык интерфейса",
      changeFolder: "Сменить папку…", selectFolder: "Выберите папку с комиксами",
      pickIntro: "Выберите папку с эпизодами NARR8. Плеер сам найдёт папки сериалов, архивы",
      pickAfterExtension: "и обложки. Все файлы остаются на вашем устройстве.",
      folderExample: "Пример структуры папок", chooseFolder: "Выбрать папку с комиксами…",
      filePrompt: "На устройстве нельзя выбрать папку?", selectFiles: "Выберите файлы эпизодов",
      welcomeBack: "С возвращением!", reconnectIntro: "Разрешите плееру снова открыть папку с комиксами",
      reconnectOutro: ".", openFolder: "Открыть папку", anotherFolder: "Выбрать другую папку…",
      opening: "Открываем папку…", scanning: "Читаем эпизоды…", comics: "Комиксы", selectedFiles: "Выбранные файлы",
      keys: "Клавиши:", nextKey: "вперёд", previousKey: "назад", contentsKey: "оглавление",
      menuKey: "меню", fullscreenKey: "полный экран", spaceKey: "Пробел",
      episode: "Эпизод", episodeTitle: "Эпизод {number}", menu: "Меню", close: "Закрыть",
      continueReading: "Продолжить", contents: "Оглавление", restart: "Начать сначала", fullscreen: "На весь экран",
      exitFullscreen: "Выйти из полноэкранного режима", episodeLanguage: "Язык эпизода", defaultLanguage: "По умолчанию",
      backToLibrary: "Вернуться в библиотеку", endOfEpisode: "Конец эпизода", endTitleTop: "Конец",
      endTitleBottom: "эпизода", lastPage: "На последнюю страницу", nextEpisode: "Следующий эпизод ›",
      replay: "Перечитать", library: "Библиотека", onGitHub: "на GitHub", openSource: "Восстановленные анимированные комиксы, открытый код",
      featured: "Эпизоды на витрине", recent: "Последние эпизоды", seriesShelf: "Сериалы", expand: "Развернуть", collapse: "Свернуть",
      empty: "В папке «{folder}» нет архивов с эпизодами NARR8. Выберите папку, в которой они находятся.",
      progress: "Страница {page} из {last}", resumeEpisode: "Возобновить: {title}", continueEpisode: "Продолжить: {title}",
      startEpisode: "Начать: {title}", unreadable: "Не удалось прочитать", cover: "Обложка", end: "КОНЕЦ",
      next: "Далее: {title}", tapToPlay: "Нажмите для воспроизведения",
      unsupported: "Для работы плеера нужен браузер с поддержкой Service Worker и страница, открытая по HTTPS или на localhost.",
      workerError: "Не удалось запустить плеер.", folderError: "Не удалось прочитать папку.",
      pickerError: "Не удалось выбрать папку.", unreadableError: "Не удалось прочитать эпизод.",
      engineError: "Не удалось запустить движок эпизода."
    }
  };

  var counts = {
    en: { series: ["series", "series"], episodes: ["episode", "episodes"], finished: ["finished", "finished"] },
    ru: { series: ["сериал", "сериала", "сериалов"], episodes: ["эпизод", "эпизода", "эпизодов"],
      finished: ["прочитан", "прочитано", "прочитано"] }
  };
  var pluralRules = { en: new Intl.PluralRules("en"), ru: new Intl.PluralRules("ru") };
  var pluralIndex = { one: 0, few: 1, many: 2, other: 1 };

  function translate(lang, key, values) {
    var message = messages[lang][key];
    return values ? message.replace(/\{(\w+)\}/g, function (_, name) { return values[name]; }) : message;
  }

  function count(lang, key, number) {
    return number + " " + counts[lang][key][pluralIndex[pluralRules[lang].select(number)]];
  }

  return { translate: translate, count: count };
})();

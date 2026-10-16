// The height range is a temporary typo check, not an availability or fitting rule.
export const CONFIG = {
  recipient: 'rubiamorenadress',
  heightMin: 100,
  heightMax: 250,
  sizes: ['S', 'M', 'L', 'Иной'],
  ui: {
    introTitle: 'Не листай. Собери свою ситуацию.',
    introDescription: 'Выберите свой запрос. Подберём образ в чате или в нашем пространстве.',
    startButton: 'Подобрать образ онлайн',
    spaceButton: 'Записаться на примерку',
    spaceTitle: 'Подобрать образ в пространстве',
    cityPrompt: 'Выберите город',
    branchTitle: 'Какой образ вы ищете?',
    formTitle: 'Уточним размер и рост',
    backButton: 'Назад',
    sizeLabel: 'Примерный размер',
    heightLabel: 'Рост, см',
    heightPlaceholder: 'Например, 168',
    contactHint: 'В чате будет готовое сообщение с вашим запросом, размером и ростом. Останется нажать “Отправить”',
    sizeError: 'Выберите примерный размер',
    heightError: 'Укажите рост в сантиметрах, например 168',
    branchError: 'Выберите направление',
  },
  branches: [
    {
      key: 'custom',
      brand: 'RUBIA&MORENA',
      cardTitle: 'Хочу эксклюзивное платье по моим меркам',
      image: 'assets/IMG_4915.jpeg',
      imageWidth: 1199,
      imageHeight: 1600,
      cta: 'Перейти в чат с Rubia&Morena',
      messageIntro: 'Здравствуйте! Хочу эксклюзивное платье Rubia&Morena по моим меркам.',
      messageEnd: 'Помогите, пожалуйста, подобрать модель.',
      collageLabel: 'по меркам',
      alt: 'Оливковое платье с пайетками и атласной юбкой',
    },
    {
      key: 'training',
      brand: 'LILIAN',
      cardTitle: 'Хочу образ на тренировку или урок',
      image: 'assets/IMG_4920.jpeg',
      imageWidth: 1200,
      imageHeight: 1600,
      cta: 'Перейти в чат с LILIAN',
      messageIntro: 'Здравствуйте! Хочу подобрать образ LILIAN на тренировку или урок.',
      messageEnd: 'Помогите, пожалуйста, с подбором.',
      collageLabel: 'тренировка / урок',
      alt: 'Фиолетовый топ и малиновая юбка на фоне кирпичной стены',
    },
    {
      key: 'milonga',
      brand: 'LILIAN',
      cardTitle: 'Хочу образ на милонгу или практику',
      image: 'assets/IMG_4914.jpeg',
      imageWidth: 1200,
      imageHeight: 1600,
      cta: 'Перейти в чат с LILIAN',
      messageIntro: 'Здравствуйте! Хочу подобрать образ LILIAN на милонгу или практику.',
      messageEnd: 'Помогите, пожалуйста, с подбором.',
      collageLabel: 'милонга / практика',
      alt: 'Тёмно-зелёное бархатное платье с открытыми плечами',
    },
  ],
  cities: [
    {
      key: 'moscow',
      label: 'В Москве',
      recipient: 'pantheleia',
      message: 'Здравствуйте! Хочу подобрать образ в вашем пространстве в Москве. Подскажите, пожалуйста, когда можно прийти на примерку?',
    },
    {
      key: 'yekaterinburg',
      label: 'В Екатеринбурге',
      recipient: 'rubiamorenadress',
      message: 'Здравствуйте! Хочу подобрать образ в вашем пространстве в Екатеринбурге. Подскажите, пожалуйста, когда можно прийти на примерку?',
    },
  ],
};

/** Keep invalid text visible; only whitespace around a value and leading zeros change. */
export function normalizeHeight(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const value = String(raw).trim();
  return /^[0-9]+$/.test(value) ? value.replace(/^0+(?=[0-9])/, '') : value;
}

/** Return field errors and a canonical string without mutating the caller's state. */
export function validate(input = {}) {
  const { branch, size, height: rawHeight } = input ?? {};
  const height = normalizeHeight(rawHeight);
  const errors = {};

  if (!CONFIG.branches.some((item) => item.key === branch)) {
    errors.branch = CONFIG.ui.branchError;
  }
  if (!CONFIG.sizes.includes(size)) errors.size = CONFIG.ui.sizeError;

  const numericHeight = Number(height);
  if (
    !/^[0-9]+$/.test(height) ||
    !Number.isSafeInteger(numericHeight) ||
    numericHeight < CONFIG.heightMin ||
    numericHeight > CONFIG.heightMax
  ) {
    errors.height = CONFIG.ui.heightError;
  }

  return { valid: Object.keys(errors).length === 0, errors, height };
}

export function buildMessage(branch, size, height) {
  const result = validate({ branch, size, height });
  if (!result.valid) {
    throw new RangeError(Object.values(result.errors).join('. '));
  }

  const selected = CONFIG.branches.find((item) => item.key === branch);
  const messageSize = size === 'Иной' ? 'иной' : size;
  return `${selected.messageIntro}\n\nМой примерный размер — ${messageSize}.\nРост — ${result.height} см.\n\n${selected.messageEnd}`;
}

export function createContactUrl(branch, size, height) {
  const message = buildMessage(branch, size, height);
  return `https://t.me/${CONFIG.recipient}?text=${encodeURIComponent(message)}`;
}

export function createCityContactUrl(cityKey) {
  const city = CONFIG.cities.find((item) => item.key === cityKey);
  if (!city) throw new RangeError(CONFIG.ui.cityPrompt);
  return `https://t.me/${city.recipient}?text=${encodeURIComponent(city.message)}`;
}

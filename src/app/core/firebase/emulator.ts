// Подключаться ли к локальным эмуляторам Firebase вместо настоящего проекта.
// В обычной сборке — нет. Сборка `ng serve --configuration emulator` подменяет этот файл
// на emulator.local.ts (fileReplacements в angular.json), и все запросы уходят на localhost.
export const USE_EMULATORS = false;

// The list of features, in the order their tabs appear. To add one, create
// js/features/<name>.js that exports { id, group, tables, views, memberSections } like speakers.js,
// then add it here.
import { speakers } from './speakers.js';
import { callingsFeature } from './callings.js';
import { calendarFeature } from './calendar.js';

export const FEATURES = [speakers, callingsFeature, calendarFeature];

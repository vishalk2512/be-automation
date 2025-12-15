const isNullOrUndefined = (value) => {
  return value === null || value === undefined
}

export const checkforValidString = (str) => {
  return !isNullOrUndefined(str) && typeof str === 'string' && str.trim().length > 0
}

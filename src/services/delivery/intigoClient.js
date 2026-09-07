const axios = require('axios');

const INTIGO_BASE_URL = 'https://api.intigo.net/api/v3';
const CACHE_TTL_MS = 10 * 60 * 1000;

const normalizeLocationName = value =>
  String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');

class IntigoClient {
  constructor() {
    this.citiesCache = null;
    this.citiesCacheAt = 0;
    this.districtsCache = new Map();
  }

  async getCities() {
    const now = Date.now();

    if (
      this.citiesCache &&
      now - this.citiesCacheAt < CACHE_TTL_MS
    ) {
      return this.citiesCache;
    }

    const response = await axios.get(
      `${INTIGO_BASE_URL}/regions/cities`,
      {
        timeout: 10000,
        headers: {
          Accept: 'application/json'
        }
      }
    );

    const cities = Array.isArray(response.data?.cities)
      ? response.data.cities
      : [];

    this.citiesCache = cities;
    this.citiesCacheAt = now;

    return cities;
  }

  async getDistricts(cityId) {
    const cached = this.districtsCache.get(String(cityId));
    const now = Date.now();

    if (
      cached &&
      now - cached.cachedAt < CACHE_TTL_MS
    ) {
      return cached.items;
    }

    const response = await axios.get(
      `${INTIGO_BASE_URL}/regions/cities/${cityId}/districts`,
      {
        timeout: 10000,
        headers: {
          Accept: 'application/json'
        }
      }
    );

    const districts = Array.isArray(response.data?.districts)
      ? response.data.districts
      : [];

    this.districtsCache.set(String(cityId), {
      items: districts,
      cachedAt: now
    });

    return districts;
  }

  findLocationByName(list, requestedName) {
    const target = normalizeLocationName(requestedName);

    if (!target) {
      return null;
    }

    return (
      list.find(item => {
        const frenchName =
          item.name ||
          item.name_fr ||
          item.label ||
          '';

        const arabicName =
          item.name_ar ||
          item.arabic_name ||
          '';

        return (
          normalizeLocationName(frenchName) === target ||
          normalizeLocationName(arabicName) === target
        );
      }) || null
    );
  }

  async resolveLocation(cityName, districtName) {
    const cities = await this.getCities();

    const city = this.findLocationByName(
      cities,
      cityName
    );

    if (!city) {
      return {
        valid: false,
        city: null,
        district: null,
        error: `Ville Intigo inconnue: ${cityName || '(vide)'}`,
        warning: null
      };
    }

    const requestedDistrict =
      String(districtName || '').trim();

    if (!requestedDistrict) {
      return {
        valid: true,
        city,
        district: null,
        error: null,
        warning:
          'Délégation absente : Intigo appliquera son mécanisme de fallback'
      };
    }

    const districts = await this.getDistricts(city.id);

    const district = this.findLocationByName(
      districts,
      requestedDistrict
    );

    if (!district) {
      return {
        valid: true,
        city,
        district: null,
        error: null,
        warning:
          `Délégation non résolue localement (${requestedDistrict}) : ` +
          'Intigo pourra utiliser le quartier, l’adresse ou son fallback'
      };
    }

    return {
      valid: true,
      city,
      district,
      error: null,
      warning: null
    };
  }
}

module.exports = new IntigoClient();

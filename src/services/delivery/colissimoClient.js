const axios = require('axios');

const COLISSIMO_CREATE_URL =
  'https://colissimodelivery.tn/api/v1/post.php';

class ColissimoClient {
  async createShipment({
    token,
    payload,
    baseUrl = COLISSIMO_CREATE_URL
  }) {
    const cleanToken =
      String(token || '').trim();

    if (!cleanToken) {
      throw new Error(
        'Colissimo add token is required'
      );
    }

    const body =
      new URLSearchParams();

    Object.entries(
      payload || {}
    ).forEach(([key, value]) => {
      if (
        value !== undefined &&
        value !== null
      ) {
        body.set(
          key,
          String(value)
        );
      }
    });

    body.set(
      'token',
      cleanToken
    );

    const response =
      await axios.post(
        baseUrl,
        body.toString(),
        {
          timeout: 15000,
          headers: {
            Accept:
              'application/json',

            'Content-Type':
              'application/x-www-form-urlencoded'
          }
        }
      );

    return {
      status:
        response.status,

      data:
        response.data
    };
  }
}

module.exports =
  new ColissimoClient();

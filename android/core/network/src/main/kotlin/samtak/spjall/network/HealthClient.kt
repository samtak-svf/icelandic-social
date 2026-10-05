package samtak.spjall.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import samtak.spjall.api.rest.apis.MetaApi
import samtak.spjall.api.rest.models.Health

/** `GET /health` through the client generated from api/openapi.json. */
class HealthClient(
    baseUrl: String,
) {
    private val api = MetaApi(baseUrl)

    suspend fun fetch(): Health = withContext(Dispatchers.IO) { api.getHealth() }
}

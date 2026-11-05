import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler(async (request, reply) => {
    await reply.status(404).send(errorBody("not_found", "Route not found", request));
  });

  app.setErrorHandler(async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error({ err: error }, "request failed");

    if (error.validation) {
      await reply
        .status(400)
        .send(errorBody("validation_error", "The request is invalid", request));
      return;
    }

    await reply
      .status(error.statusCode && error.statusCode < 500 ? error.statusCode : 500)
      .send(errorBody("internal_error", "Internal server error", request));
  });
}

function errorBody(code: string, message: string, request: FastifyRequest): ErrorBody {
  return {
    error: {
      code,
      message,
      request_id: request.id,
    },
  };
}

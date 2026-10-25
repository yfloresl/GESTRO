import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** Errores con forma uniforme y en español; los internos no filtran detalles ni secretos. */
@Catch()
export class FiltroDeErrores implements ExceptionFilter {
  private readonly log = new Logger('Errores');

  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof ZodError) {
      return res.status(400).json({ code: 'VALIDATION', message: 'Datos inválidos', errores: error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })) });
    }
    if (error instanceof HttpException) {
      const cuerpo = error.getResponse();
      const base = typeof cuerpo === 'string' ? { message: cuerpo } : (cuerpo as Record<string, unknown>);
      return res.status(error.getStatus()).json({ code: base.code ?? HttpStatus[error.getStatus()], message: base.message });
    }
    this.log.error(error instanceof Error ? error.stack : String(error));
    return res.status(500).json({ code: 'INTERNAL', message: 'Error interno' });
  }
}

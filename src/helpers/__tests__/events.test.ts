import { EventEmitter } from 'node:events';
import { onceWhen } from '../events';

describe('onceWhen tests', () => {
  test('should resolve when event is emitted and predicate matches', async () => {
    const emitter = new EventEmitter<{
      myTestEvent: [eventNumber: number, msg: string];
    }>();

    setTimeout(() => {
      for (let i = 0; i <= 5; i++) {
        emitter.emit('myTestEvent', i, `Message ${i}`);
      }
    }, 10); // Emit after a delay

    const [eventNumber, msg] = await onceWhen(emitter, 'myTestEvent', (eventNumber, msg) => {
      return eventNumber === 5;
    });
    expect(eventNumber).toBe(5);
    expect(msg).toBe('Message 5');

    // Expect that the event listener was removed after onceWhen is finished
    expect(emitter.eventNames()).toStrictEqual([]);
  });

  test('should reject if aborted immediately', async () => {
    const emitter = new EventEmitter<{
      myTestEvent: [eventNumber: number];
    }>();
    const controller = new AbortController();
    const abortReason = new Error('Test aborted');
    controller.abort(abortReason);
    await expect(
      onceWhen(emitter, 'myTestEvent', () => true, { signal: controller.signal })
    ).rejects.toThrow(abortReason);

    // Expect that the event listener was removed after onceWhen is finished
    expect(emitter.eventNames()).toStrictEqual([]);
  });

  test('should reject if aborted before event is emitted', async () => {
    const emitter = new EventEmitter<{
      myTestEvent: [eventNumber: number];
    }>();
    const controller = new AbortController();
    const abortReason = new Error('Test aborted');
    // controller.abort(abortReason);
    setTimeout(() => {
      for (let i = 0; i <= 5; i++) {
        emitter.emit('myTestEvent', i);
        if (i === 3) {
          controller.abort(abortReason); // Abort after emitting some events
        }
      }
    }, 10); // Emit after a delay

    let lastEventNumberSeen = 0;
    await expect(
      onceWhen(
        emitter,
        'myTestEvent',
        eventNumber => {
          lastEventNumberSeen = eventNumber;
          return false;
        },
        { signal: controller.signal }
      )
    ).rejects.toThrow(abortReason);

    // Check that we saw events before the abort
    expect(lastEventNumberSeen).toBe(3);

    // Expect that the event listener was removed after onceWhen is finished
    expect(emitter.eventNames()).toStrictEqual([]);
  });

  test('should resolve if event is emitted before abort', async () => {
    const emitter = new EventEmitter<{
      myTestEvent: [eventNumber: number];
    }>();
    const controller = new AbortController();

    setTimeout(() => {
      for (let i = 0; i <= 5; i++) {
        emitter.emit('myTestEvent', i);
      }
      controller.abort(); // Abort after emitting all events
    }, 10); // Emit after a delay

    const [eventNumber] = await onceWhen(emitter, 'myTestEvent', eventNumber => eventNumber === 5, {
      signal: controller.signal,
    });
    expect(eventNumber).toBe(5);

    // Expect that the event listener was removed after onceWhen is finished
    expect(emitter.eventNames()).toStrictEqual([]);
  });

  test('should reject if predict function throws', async () => {
    const emitter = new EventEmitter<{
      myTestEvent: [eventNumber: number];
    }>();
    setTimeout(() => {
      for (let i = 0; i <= 5; i++) {
        emitter.emit('myTestEvent', i);
      }
    }, 10);

    let lastEventNumberSeen = 0;
    const predictFunctionError = new Error('Predict function error');
    await expect(
      onceWhen(emitter, 'myTestEvent', eventNumber => {
        lastEventNumberSeen = eventNumber;
        if (eventNumber === 3) {
          throw predictFunctionError;
        }
        return false;
      })
    ).rejects.toThrow(predictFunctionError);
    expect(lastEventNumberSeen).toBe(3);

    // Expect that the event listener was removed after onceWhen is finished
    expect(emitter.eventNames()).toStrictEqual([]);
  });
});

import {retryUntil, retryUntilDone} from './retry';

describe('retry', () => {
  describe('retryUntil', () => {

    it('should retry three times', async () => {
      let count = 0;
      await retryUntil(() => {
        count++;
        return count >= 3;
      }, 1);
      expect(count).toBe(3);
    });

    it('should throw an exception', (done) => {
      retryUntil(() => {
        throw new Error('error');
      }, 1)
        .catch((error) => {
          expect(error).toBeDefined();
          expect(error).toBeInstanceOf(Error);
          done();
        });
    });
  });

  describe('retry', () => {

    it('should retry three times', async () => {
      let count = 0;
      await retryUntilDone((done) => {
        if (count >= 3) return done();

        count++;
      }, 1);
      expect(count).toBe(3);
    });

    it('should throw an exception', (done) => {
      retryUntilDone(() => {
        throw new Error('error');
      }, 1)
        .catch((error) => {
          expect(error).toBeDefined();
          expect(error).toBeInstanceOf(Error);
          done();
        });
    });

    it('should throw an exception after 2 retries', (done) => {
      let count = 0;
      retryUntilDone(() => {
        if (count >= 2) throw new Error('error');

        count++;
      }, 1)
        .catch((error) => {
          expect(error).toBeDefined();
          expect(error).toBeInstanceOf(Error);
          expect(count).toBe(2);
          done();
        });
    });
  });
});


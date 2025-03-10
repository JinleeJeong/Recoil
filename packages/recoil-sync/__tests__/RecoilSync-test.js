/**
 * Copyright (c) Facebook, Inc. and its affiliates. Confidential and proprietary.
 *
 * @flow strict-local
 * @format
 * @oncall recoil
 */

'use strict';

import type {ItemKey, ItemSnapshot, ListenInterface} from '../RecoilSync';
import type {Loadable} from 'Recoil';

const {act} = require('ReactTestUtils');
const {
  DefaultValue,
  RecoilLoadable,
  RecoilRoot,
  atom,
  atomFamily,
  selectorFamily,
  useRecoilValue,
} = require('Recoil');

const {
  RecoilSync,
  registries_FOR_TESTING,
  syncEffect,
  useRecoilSync,
} = require('../RecoilSync');
const React = require('react');
const {useCallback, useState} = require('react');
const {
  ReadsAtom,
  componentThatReadsAndWritesAtom,
  flushPromisesAndTimers,
  renderElements,
} = require('recoil-shared/__test_utils__/Recoil_TestingUtils');
const isPromise = require('recoil-shared/util/Recoil_isPromise');
const {asType, dict, literal, match, number, string} = require('refine');

////////////////////////////
// Mock Storage
////////////////////////////
function TestRecoilSync({
  storeKey,
  storage,
  regListen,
  allItemsRef,
  children = null,
}: {
  storeKey?: string,
  storage: Map<string, mixed>,
  regListen?: ListenInterface => void,
  allItemsRef?: {current: Map<string, DefaultValue | mixed>},
  children?: React.Node,
}) {
  return (
    <RecoilSync
      storeKey={storeKey}
      read={itemKey => {
        if (itemKey === 'error') {
          throw new Error('READ ERROR');
        }
        if (itemKey === 'reject') {
          return Promise.reject(new Error('READ REJECT'));
        }
        return storage.has(itemKey) ? storage.get(itemKey) : new DefaultValue();
      }}
      write={({diff, allItems}) => {
        for (const [key, value] of diff.entries()) {
          value instanceof DefaultValue
            ? storage.delete(key)
            : storage.set(key, value);
        }
        for (const [itemKey, value] of diff) {
          expect(allItems.get(itemKey)).toEqual(value);
        }
        if (allItemsRef != null) {
          allItemsRef.current = allItems;
        }
      }}
      listen={listenInterface => {
        regListen?.(listenInterface);
      }}>
      {children}
    </RecoilSync>
  );
}

///////////////////////
// Tests
///////////////////////
test('Write to storage', async () => {
  const atomA = atom({
    key: 'recoil-sync write A',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync write B',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });
  const ignoreAtom = atom({
    key: 'recoil-sync write ignore',
    default: 'DEFAULT',
  });

  const storage = new Map();

  const [AtomA, setA, resetA] = componentThatReadsAndWritesAtom(atomA);
  const [AtomB, setB] = componentThatReadsAndWritesAtom(atomB);
  const [IgnoreAtom, setIgnore] = componentThatReadsAndWritesAtom(ignoreAtom);
  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <AtomA />
      <AtomB />
      <IgnoreAtom />
    </TestRecoilSync>,
  );

  expect(storage.size).toBe(0);
  expect(container.textContent).toBe('"DEFAULT""DEFAULT""DEFAULT"');

  act(() => setA('A'));
  act(() => setB('B'));
  act(() => setIgnore('IGNORE'));
  expect(container.textContent).toBe('"A""B""IGNORE"');
  expect(storage.size).toBe(2);
  expect(storage.get('recoil-sync write A')).toBe('A');
  expect(storage.get('recoil-sync write B')).toBe('B');

  act(() => resetA());
  act(() => setB('BB'));
  expect(container.textContent).toBe('"DEFAULT""BB""IGNORE"');
  expect(storage.size).toBe(1);
  expect(storage.has('recoil-sync write A')).toBe(false);
  expect(storage.get('recoil-sync write B')).toBe('BB');
});

test('Write to multiple storages', async () => {
  const atomA = atom({
    key: 'recoil-sync multiple storage A',
    default: 'DEFAULT',
    effects: [syncEffect({storeKey: 'A', refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync multiple storage B',
    default: 'DEFAULT',
    effects: [syncEffect({storeKey: 'B', refine: string()})],
  });

  const storageA = new Map();
  const storageB = new Map();

  const [AtomA, setA] = componentThatReadsAndWritesAtom(atomA);
  const [AtomB, setB] = componentThatReadsAndWritesAtom(atomB);
  renderElements(
    <>
      <TestRecoilSync storeKey="A" storage={storageA} />
      <TestRecoilSync storeKey="B" storage={storageB} />
      <AtomA />
      <AtomB />
    </>,
  );

  expect(storageA.size).toBe(0);
  expect(storageB.size).toBe(0);

  act(() => setA('A'));
  act(() => setB('B'));
  expect(storageA.size).toBe(1);
  expect(storageB.size).toBe(1);
  expect(storageA.get('recoil-sync multiple storage A')).toBe('A');
  expect(storageB.get('recoil-sync multiple storage B')).toBe('B');
});

test('Read from storage', async () => {
  const atomA = atom({
    key: 'recoil-sync read A',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync read B',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });
  const atomC = atom({
    key: 'recoil-sync read C',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });

  const storage = new Map([
    ['recoil-sync read A', 'A'],
    ['recoil-sync read B', 'B'],
  ]);

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
    </TestRecoilSync>,
  );

  expect(container.textContent).toBe('"A""B""DEFAULT"');
});

test('Read from storage async', async () => {
  const atomA = atom({
    key: 'recoil-sync read async',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });

  const storage = new Map([['recoil-sync read async', Promise.resolve('A')]]);

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atomA} />
    </TestRecoilSync>,
  );

  expect(container.textContent).toBe('loading');
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"A"');
});

test('Read from storage error', async () => {
  const atomA = atom({
    key: 'recoil-sync read error A',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync read error B',
    default: 'DEFAULT',
    effects: [
      syncEffect({refine: string(), actionOnFailure_UNSTABLE: 'defaultValue'}),
    ],
  });
  const atomC = atom({
    key: 'recoil-sync read error C',
    default: 'DEFAULT',
    // <TestRecoilSync> will throw error if the key is "error"
    effects: [syncEffect({itemKey: 'error', refine: string()})],
  });
  const atomD = atom({
    key: 'recoil-sync read error D',
    default: 'DEFAULT',
    // <TestRecoilSync> will throw error if the key is "error"
    effects: [
      syncEffect({
        itemKey: 'error',
        refine: string(),
        actionOnFailure_UNSTABLE: 'defaultValue',
      }),
    ],
  });
  const atomE = atom({
    key: 'recoil-sync read error E',
    default: 'DEFAULT',
    effects: [
      syncEffect({
        refine: string(),
      }),
    ],
  });
  const atomF = atom({
    key: 'recoil-sync read error F',
    default: 'DEFAULT',
    effects: [
      syncEffect({
        refine: string(),
        actionOnFailure_UNSTABLE: 'defaultValue',
      }),
    ],
  });
  const atomG = atom({
    key: 'recoil-sync read error G',
    default: 'DEFAULTx',
    effects: [
      syncEffect({
        itemKey: 'reject',
        refine: string(),
      }),
    ],
  });

  const mySelector = selectorFamily({
    key: 'recoil-sync read error selector',
    get:
      ({myAtom}) =>
      ({get}) => {
        try {
          return get(myAtom);
        } catch (e) {
          if (isPromise(e)) {
            return e.catch(err => err);
          }
          return e.message;
        }
      },
  });

  const storage = new Map([
    ['recoil-sync read error A', RecoilLoadable.error(new Error('ERROR A'))],
    ['recoil-sync read error B', RecoilLoadable.error(new Error('ERROR B'))],
    ['recoil-sync read error E', 999],
    ['recoil-sync read error F', 999],
  ]);

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={mySelector({myAtom: atomA})} />
      <ReadsAtom atom={mySelector({myAtom: atomB})} />
      <ReadsAtom atom={mySelector({myAtom: atomC})} />
      <ReadsAtom atom={mySelector({myAtom: atomD})} />
      <ReadsAtom atom={mySelector({myAtom: atomE})} />
      <ReadsAtom atom={mySelector({myAtom: atomF})} />
      <ReadsAtom atom={mySelector({myAtom: atomG})} />
    </TestRecoilSync>,
  );

  await flushPromisesAndTimers();
  expect(container.textContent).toBe(
    '"ERROR A""DEFAULT""READ ERROR""DEFAULT""[<root>]: value is not a string""DEFAULT""READ REJECT"',
  );
});

test('Read nullable', async () => {
  const atomUndefinedA = atom({
    key: 'recoil-sync read undefined A',
    default: 'DEFAULT',
    effects: [syncEffect({refine: literal(undefined)})],
  });
  const atomUndefinedB = atom({
    key: 'recoil-sync read undefined B',
    default: 'DEFAULT',
    effects: [syncEffect({refine: literal(undefined)})],
  });
  const atomUndefinedC = atom({
    key: 'recoil-sync read undefined C',
    default: 'DEFAULT',
    effects: [syncEffect({refine: literal(undefined)})],
  });
  const atomNullA = atom({
    key: 'recoil-sync read null A',
    default: 'DEFAULT',
    effects: [syncEffect({refine: literal(null)})],
  });
  const atomNullB = atom({
    key: 'recoil-sync read null B',
    default: 'DEFAULT',
    effects: [syncEffect({refine: literal(null)})],
  });
  const atomNullC = atom({
    key: 'recoil-sync read null C',
    default: 'DEFAULT',
    effects: [syncEffect({refine: literal(null)})],
  });

  const storage = new Map([
    ['recoil-sync read undefined A', undefined],
    ['recoil-sync read undefined B', Promise.resolve(undefined)],
    ['recoil-sync read undefined C', RecoilLoadable.of(undefined)],
    ['recoil-sync read null A', null],
    ['recoil-sync read null B', Promise.resolve(null)],
    ['recoil-sync read null C', RecoilLoadable.of(null)],
  ]);

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atomUndefinedA} />
      <ReadsAtom atom={atomUndefinedB} />
      <ReadsAtom atom={atomUndefinedC} />
      <ReadsAtom atom={atomNullA} />
      <ReadsAtom atom={atomNullB} />
      <ReadsAtom atom={atomNullC} />
    </TestRecoilSync>,
  );

  expect(container.textContent).toBe('loading');
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('nullnullnull');
});

test('Abort read', async () => {
  const atomA = atom({
    key: 'recoil-sync abort read A',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync abort read B',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });
  const atomC = atom({
    key: 'recoil-sync abort read C',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string()})],
  });

  const storage = new Map([
    ['recoil-sync abort read A', new DefaultValue()],
    ['recoil-sync abort read B', Promise.resolve(new DefaultValue())],
    ['recoil-sync abort read C', RecoilLoadable.of(new DefaultValue())],
  ]);

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
    </TestRecoilSync>,
  );

  expect(container.textContent).toBe('loading');
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"DEFAULT""DEFAULT""DEFAULT"');
});

// TODO These semantics are debatable...
test('Abort vs reset', async () => {
  const atomA = atom({
    key: 'recoil-sync abort vs reset A',
    default: 'DEFAULT',
    effects: [({setSelf}) => setSelf('INIT'), syncEffect({refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync abort vs reset B',
    default: 'DEFAULT',
    effects: [({setSelf}) => setSelf('INIT'), syncEffect({refine: string()})],
  });
  const atomC = atom({
    key: 'recoil-sync abort vs reset C',
    default: 'DEFAULT',
    effects: [({setSelf}) => setSelf('INIT'), syncEffect({refine: string()})],
  });
  const atomD = atom({
    key: 'recoil-sync abort vs reset D',
    default: 'DEFAULT',
    effects: [({setSelf}) => setSelf('INIT'), syncEffect({refine: string()})],
  });

  const storage = new Map([
    ['recoil-sync abort vs reset A', new DefaultValue()],
    ['recoil-sync abort vs reset B', RecoilLoadable.of(new DefaultValue())],
    ['recoil-sync abort vs reset C', Promise.resolve(new DefaultValue())],
    [
      'recoil-sync abort vs reset D',
      RecoilLoadable.of(Promise.resolve(new DefaultValue())),
    ],
  ]);

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
      <ReadsAtom atom={atomD} />
    </TestRecoilSync>,
  );

  expect(container.textContent).toBe('loading');
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"INIT""INIT""DEFAULT""DEFAULT"');
});

test('Read from storage upgrade - multiple effects', async () => {
  // Fail validation
  const atomA = atom<string>({
    key: 'recoil-sync fail validation - multi',
    default: 'DEFAULT',
    effects: [
      // No matching sync effect
      syncEffect({refine: string(), actionOnFailure_UNSTABLE: 'defaultValue'}),
    ],
  });

  // Upgrade from number
  const atomB = atom<string>({
    key: 'recoil-sync upgrade number - multi',
    default: 'DEFAULT',
    effects: [
      // This sync effect is ignored
      syncEffect({
        refine: asType(string(), () => 'IGNORE'),
        actionOnFailure_UNSTABLE: 'defaultValue',
      }),
      syncEffect({
        refine: asType(number(), num => `${num}`),
        actionOnFailure_UNSTABLE: 'defaultValue',
      }),
      // This sync effect is ignored
      syncEffect({
        refine: asType(string(), () => 'IGNORE'),
        actionOnFailure_UNSTABLE: 'defaultValue',
      }),
    ],
  });

  // Upgrade from string
  const atomC = atom<number>({
    key: 'recoil-sync upgrade string - multi',
    default: 0,
    effects: [
      // This sync effect is ignored
      syncEffect({
        refine: asType(number(), () => 999),
        actionOnFailure_UNSTABLE: 'defaultValue',
      }),
      syncEffect({
        refine: asType(string(), Number),
        actionOnFailure_UNSTABLE: 'defaultValue',
      }),
      // This sync effect is ignored
      syncEffect({
        refine: asType(number(), () => 999),
        actionOnFailure_UNSTABLE: 'defaultValue',
      }),
    ],
  });

  // Upgrade from async
  const atomD = atom<string>({
    key: 'recoil-sync upgrade async - multi',
    default: 'DEFAULT',
    effects: [
      syncEffect({
        refine: asType(number(), num => `${num}`),
        actionOnFailure_UNSTABLE: 'defaultValue',
      }),
    ],
  });

  const storage = new Map([
    ['recoil-sync fail validation - multi', 123],
    ['recoil-sync upgrade number - multi', 123],
    ['recoil-sync upgrade string - multi', '123'],
    ['recoil-sync upgrade async - multi', Promise.resolve(123)],
  ]);

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
      <ReadsAtom atom={atomD} />
    </TestRecoilSync>,
  );

  expect(container.textContent).toBe('loading');
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"DEFAULT""123"123"123"');
});

test('Read from storage upgrade', async () => {
  // Fail validation
  const atomA = atom<string>({
    key: 'recoil-sync fail validation',
    default: 'DEFAULT',
    effects: [
      // No matching sync effect
      syncEffect({refine: string(), actionOnFailure_UNSTABLE: 'defaultValue'}),
    ],
  });

  // Upgrade from number
  const atomB = atom<string>({
    key: 'recoil-sync upgrade number',
    default: 'DEFAULT',
    effects: [
      syncEffect({
        refine: match(
          asType(string(), () => 'IGNORE'), // This rule is ignored
          asType(number(), num => `${num}`),
          asType(string(), () => 'IGNORE'), // This rule is ignored
        ),
      }),
    ],
  });

  // Upgrade from string
  const atomC = atom<number>({
    key: 'recoil-sync upgrade string',
    default: 0,
    effects: [
      syncEffect({
        refine: match(
          asType(number(), () => 999), // This rule is ignored
          asType(string(), Number),
          asType(number(), () => 999), // This rule is ignored
        ),
      }),
    ],
  });

  // Upgrade from async
  const atomD = atom<string>({
    key: 'recoil-sync upgrade async',
    default: 'DEFAULT',
    effects: [
      syncEffect({
        refine: match(
          string(),
          asType(number(), num => `${num}`),
        ),
      }),
    ],
  });

  const storage = new Map([
    ['recoil-sync fail validation', 123],
    ['recoil-sync upgrade number', 123],
    ['recoil-sync upgrade string', '123'],
    ['recoil-sync upgrade async', Promise.resolve(123)],
  ]);

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
      <ReadsAtom atom={atomD} />
    </TestRecoilSync>,
  );

  expect(container.textContent).toBe('loading');
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"DEFAULT""123"123"123"');
});

test('Read/Write from storage upgrade', async () => {
  const atomA = atom<string>({
    key: 'recoil-sync read/write upgrade type',
    default: 'DEFAULT',
    effects: [
      syncEffect({
        refine: match(
          string(),
          asType(number(), num => `${num}`),
        ),
      }),
    ],
  });
  const atomB = atom({
    key: 'recoil-sync read/write upgrade key',
    default: 'DEFAULT',
    effects: [
      syncEffect({itemKey: 'OLD KEY', refine: string()}),
      syncEffect({itemKey: 'NEW KEY', refine: string()}),
    ],
  });
  const atomC = atom({
    key: 'recoil-sync read/write upgrade storage',
    default: 'DEFAULT',
    effects: [
      syncEffect({refine: string()}),
      syncEffect({storeKey: 'OTHER_SYNC', refine: string()}),
    ],
  });

  const storage1 = new Map([
    ['recoil-sync read/write upgrade type', 123],
    ['OLD KEY', 'OLD'],
    ['recoil-sync read/write upgrade storage', 'STR1'],
  ]);
  const storage2 = new Map([
    ['recoil-sync read/write upgrade storage', 'STR2'],
  ]);

  const [AtomA, setA, resetA] = componentThatReadsAndWritesAtom(atomA);
  const [AtomB, setB, resetB] = componentThatReadsAndWritesAtom(atomB);
  const [AtomC, setC, resetC] = componentThatReadsAndWritesAtom(atomC);
  const container = renderElements(
    <>
      <TestRecoilSync storage={storage1} />
      <TestRecoilSync storage={storage2} storeKey="OTHER_SYNC" />
      <AtomA />
      <AtomB />
      <AtomC />
    </>,
  );

  expect(container.textContent).toBe('"123""OLD""STR2"');
  expect(storage1.size).toBe(3);

  act(() => setA('A'));
  act(() => setB('B'));
  act(() => setC('C'));
  expect(container.textContent).toBe('"A""B""C"');
  expect(storage1.size).toBe(4);
  expect(storage1.get('recoil-sync read/write upgrade type')).toBe('A');
  expect(storage1.get('OLD KEY')).toBe('B');
  expect(storage1.get('NEW KEY')).toBe('B');
  expect(storage1.get('recoil-sync read/write upgrade storage')).toBe('C');
  expect(storage2.size).toBe(1);
  expect(storage2.get('recoil-sync read/write upgrade storage')).toBe('C');

  act(() => resetA());
  act(() => resetB());
  act(() => resetC());
  expect(container.textContent).toBe('"DEFAULT""DEFAULT""DEFAULT"');
  expect(storage1.size).toBe(0);
  expect(storage2.size).toBe(0);
});

test('Listen to storage', async () => {
  const atomA = atom({
    key: 'recoil-sync listen',
    default: 'DEFAULT',
    effects: [syncEffect({storeKey: 'SYNC_1', refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync listen to multiple keys',
    default: 'DEFAULT',
    effects: [
      syncEffect({storeKey: 'SYNC_1', itemKey: 'KEY A', refine: string()}),
      syncEffect({storeKey: 'SYNC_1', itemKey: 'KEY B', refine: string()}),
    ],
  });
  const atomC = atom({
    key: 'recoil-sync listen to multiple storage',
    default: 'DEFAULT',
    effects: [
      syncEffect({storeKey: 'SYNC_1', refine: string()}),
      syncEffect({storeKey: 'SYNC_2', refine: string()}),
    ],
  });

  const storage1 = new Map([
    ['recoil-sync listen', 'A'],
    ['KEY A', 'B'],
    ['recoil-sync listen to multiple storage', 'C1'],
  ]);
  const storage2 = new Map([['recoil-sync listen to multiple storage', 'C2']]);

  let updateItem1: (ItemKey, DefaultValue | Loadable<string> | string) => void =
    () => {
      throw new Error('Failed to register 1');
    };
  let updateItems1: ItemSnapshot => void = _ => {
    throw new Error('Failed to register 1');
  };
  let updateAll1: ItemSnapshot => void = _ => {
    throw new Error('Failed to register 1');
  };
  let updateItem2: (ItemKey, DefaultValue | string) => void = () => {
    throw new Error('Failed to register 2');
  };
  const container = renderElements(
    <TestRecoilSync
      storeKey="SYNC_1"
      storage={storage1}
      regListen={listenInterface => {
        updateItem1 = listenInterface.updateItem;
        updateItems1 = listenInterface.updateItems;
        updateAll1 = listenInterface.updateAllKnownItems;
      }}>
      <TestRecoilSync
        storeKey="SYNC_2"
        storage={storage2}
        regListen={listenInterface => {
          updateItem2 = listenInterface.updateItem;
        }}>
        <ReadsAtom atom={atomA} />
        <ReadsAtom atom={atomB} />
        <ReadsAtom atom={atomC} />
      </TestRecoilSync>
    </TestRecoilSync>,
  );

  expect(container.textContent).toBe('"A""B""C2"');
  expect(storage1.size).toBe(3);

  // Subscribe to new value
  act(() => updateItem1('recoil-sync listen', 'AA'));
  expect(container.textContent).toBe('"AA""B""C2"');
  // Avoid feedback loops
  expect(storage1.get('recoil-sync listen')).toBe('A');

  // Subscribe to reset
  act(() => updateItem1('recoil-sync listen', new DefaultValue()));
  expect(container.textContent).toBe('"DEFAULT""B""C2"');
  act(() => updateItem1('recoil-sync listen', 'AA'));

  // Subscribe to new value from different key
  act(() => updateItem1('KEY A', 'BB'));
  expect(container.textContent).toBe('"AA""BB""C2"');
  // Neither key in same storage will be updated to avoid feedback loops
  expect(storage1.get('KEY A')).toBe('B');
  expect(storage1.get('KEY B')).toBe(undefined);
  act(() => updateItem1('KEY B', 'BBB'));
  expect(container.textContent).toBe('"AA""BBB""C2"');
  expect(storage1.get('KEY A')).toBe('B');
  expect(storage1.get('KEY B')).toBe(undefined);

  // Subscribe to new value from different storage
  act(() => updateItem1('recoil-sync listen to multiple storage', 'CC1'));
  expect(container.textContent).toBe('"AA""BBB""CC1"');
  // Avoid feedback loops, do not update storage based on listening to the storage
  expect(storage1.get('recoil-sync listen to multiple storage')).toBe('C1');
  // But, we should update other storages to stay in sync
  expect(storage2.get('recoil-sync listen to multiple storage')).toBe('CC1');

  act(() => updateItem2('recoil-sync listen to multiple storage', 'CC2'));
  expect(container.textContent).toBe('"AA""BBB""CC2"');
  expect(storage1.get('recoil-sync listen to multiple storage')).toBe('CC2');
  expect(storage2.get('recoil-sync listen to multiple storage')).toBe('CC1');

  act(() => updateItem1('recoil-sync listen to multiple storage', 'CCC1'));
  expect(container.textContent).toBe('"AA""BBB""CCC1"');
  expect(storage1.get('recoil-sync listen to multiple storage')).toBe('CC2');
  expect(storage2.get('recoil-sync listen to multiple storage')).toBe('CCC1');

  // Subscribe to reset
  act(() =>
    updateItem1('recoil-sync listen to multiple storage', new DefaultValue()),
  );
  expect(container.textContent).toBe('"AA""BBB""DEFAULT"');
  expect(storage1.get('recoil-sync listen to multiple storage')).toBe('CC2');
  expect(storage2.get('recoil-sync listen to multiple storage')).toBe(
    undefined,
  );

  // Subscribe to error
  const ERROR = new Error('ERROR');
  act(() => updateItem1('recoil-sync listen', RecoilLoadable.error(ERROR)));
  // TODO Atom should be put in an error state, but is just reset for now.
  expect(container.textContent).toBe('"DEFAULT""BBB""DEFAULT"');
  // expect(storage1.get('recoil-sync listen')?.errorOrThrow()).toBe(ERROR);

  // Update Items
  // Set A while keeping B and C
  act(() => updateItems1(new Map([['recoil-sync listen', 'AAAA']])));
  expect(container.textContent).toBe('"AAAA""BBB""DEFAULT"');

  // Update All Items
  // Set A while resetting B
  act(() => updateAll1(new Map([['recoil-sync listen', 'AAA']])));
  expect(container.textContent).toBe('"AAA""DEFAULT""DEFAULT"');

  // Update All Items
  // Setting older Key while newer Key is blank will take value instead of default
  act(() =>
    updateAll1(
      new Map([
        ['recoil-sync listen', 'AAA'],
        ['KEY A', 'BBB'],
      ]),
    ),
  );
  expect(container.textContent).toBe('"AAA""BBB""DEFAULT"');

  // Update All Items
  // Setting an older and newer key will take the newer key value
  act(() =>
    updateAll1(
      new Map([
        ['recoil-sync listen', 'AAA'],
        ['KEY A', 'IGNORE'],
        ['KEY B', 'BBBB'],
      ]),
    ),
  );
  expect(container.textContent).toBe('"AAA""BBBB""DEFAULT"');

  // Update All Items
  // Not providing an item causes it to revert to default
  act(() => updateAll1(new Map([['recoil-sync listen', 'AAA']])));
  expect(container.textContent).toBe('"AAA""DEFAULT""DEFAULT"');

  // TODO Async Atom support
  // act(() =>
  //   updateItem1(
  //     'recoil-sync listen',
  //     (Promise.resolve( 'ASYNC')),
  //   ),
  // );
  // await flushPromisesAndTimers();
  // expect(container.textContent).toBe('"ASYNC""BBBB""DEFAULT"');

  // act(() =>
  //   updateItem1(
  //     'KEY B', (Promise.reject(new Error('ERROR B'))),
  //   ),
  // );
  // await flushPromisesAndTimers();
  // expect(container.textContent).toBe('error');
});

test('Persist on read', async () => {
  const atomA = atom({
    key: 'recoil-sync persist on read default',
    default: 'DEFAULT',
    effects: [syncEffect({refine: string(), syncDefault: true})],
  });
  const atomB = atom({
    key: 'recoil-sync persist on read init',
    default: 'DEFAULT',
    effects: [
      ({setSelf}) => setSelf('INIT_BEFORE'),
      syncEffect({refine: string(), syncDefault: true}),
      ({setSelf}) => setSelf('INIT_AFTER'),
    ],
  });

  const storage = new Map();

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
    </TestRecoilSync>,
  );

  expect(storage.size).toBe(0);
  expect(container.textContent).toBe('"DEFAULT""INIT_AFTER"');

  await flushPromisesAndTimers();

  expect(storage.size).toBe(2);
  expect(storage.get('recoil-sync persist on read default')).toBe('DEFAULT');
  expect(storage.get('recoil-sync persist on read init')).toBe('INIT_AFTER');
});

test('Persist on read - async', async () => {
  let resolveA, resolveB1, resolveB2;

  const atomA = atom({
    key: 'recoil-sync persist on read default async',
    default: new Promise(resolve => {
      resolveA = resolve;
    }),
    effects: [syncEffect({refine: string(), syncDefault: true})],
  });
  const atomB = atom({
    key: 'recoil-sync persist on read init async',
    default: 'DEFAULT',
    effects: [
      ({setSelf}) =>
        setSelf(
          new Promise(resolve => {
            resolveB1 = resolve;
          }),
        ),
      syncEffect({refine: string(), syncDefault: true}),
      ({setSelf}) =>
        setSelf(
          new Promise(resolve => {
            resolveB2 = resolve;
          }),
        ),
    ],
  });

  const storage = new Map();

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
    </TestRecoilSync>,
  );

  await flushPromisesAndTimers();
  expect(storage.size).toBe(0);

  act(() => {
    resolveA('ASYNC_DEFAULT');
  });
  await flushPromisesAndTimers();
  expect(storage.size).toBe(1);

  act(() => {
    resolveB1('ASYNC_INIT_BEFORE');
  });
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('loading');
  expect(storage.size).toBe(1);

  act(() => {
    resolveB2('ASYNC_INIT_AFTER');
  });
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"ASYNC_DEFAULT""ASYNC_INIT_AFTER"');
  expect(storage.size).toBe(2);
  expect(storage.get('recoil-sync persist on read default async')).toBe(
    'ASYNC_DEFAULT',
  );
  expect(storage.get('recoil-sync persist on read init async')).toBe(
    'ASYNC_INIT_AFTER',
  );
});

test('Sync based on component props', async () => {
  function SyncWithProps({
    children,
    ...props
  }: {
    children: React.Node,
    eggs: string,
    spam: string,
  }) {
    return (
      <RecoilSync
        read={itemKey =>
          itemKey in props ? props[itemKey] : new DefaultValue()
        }>
        {children}
      </RecoilSync>
    );
  }

  const atomA = atom({
    key: 'recoil-sync from props spam',
    default: 'DEFAULT',
    effects: [syncEffect({itemKey: 'spam', refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync from props eggs',
    default: 'DEFAULT',
    effects: [syncEffect({itemKey: 'eggs', refine: string()})],
  });
  const atomC = atom({
    key: 'recoil-sync from props default',
    default: 'DEFAULT',
    effects: [syncEffect({itemKey: 'default', refine: string()})],
  });

  const container = renderElements(
    <SyncWithProps spam="SPAM" eggs="EGGS">
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
    </SyncWithProps>,
  );

  expect(container.textContent).toBe('"SPAM""EGGS""DEFAULT"');
});

test('Sync Atom Family', async () => {
  const atoms = atomFamily({
    key: 'recoil-sync atom family',
    default: 'DEFAULT',
    effects: param => [syncEffect({itemKey: param, refine: string()})],
  });

  const storage = new Map([
    ['a', 'A'],
    ['b', 'B'],
  ]);

  const container = renderElements(
    <TestRecoilSync storage={storage}>
      <ReadsAtom atom={atoms('a')} />
      <ReadsAtom atom={atoms('b')} />
      <ReadsAtom atom={atoms('c')} />
    </TestRecoilSync>,
  );

  expect(container.textContent).toBe('"A""B""DEFAULT"');
});

describe('Complex Mappings', () => {
  test('write to multiple items', async () => {
    const atomA = atom({
      key: 'recoil-sync write multiple A',
      default: 'A',
      effects: [
        syncEffect({
          itemKey: 'a', // UNUSED
          refine: string(),
          write: ({write}, newValue) => {
            write(
              'a1',
              newValue instanceof DefaultValue ? newValue : newValue + '1',
            );
            write(
              'a2',
              newValue instanceof DefaultValue ? newValue : newValue + '2',
            );
          },
          syncDefault: true,
        }),
      ],
    });

    const atomB = atom({
      key: 'recoil-sync write multiple B',
      default: 'DEFAULT',
      effects: [
        syncEffect({
          itemKey: 'b', // UNUSED
          refine: string(),
          write: ({write, reset}, newValue) => {
            if (newValue instanceof DefaultValue) {
              reset('b1');
              reset('b2');
            } else {
              write('b1', newValue + '1');
              write('b2', newValue + '2');
            }
          },
        }),
      ],
    });
    const [AtomB, setB, resetB] = componentThatReadsAndWritesAtom(atomB);

    const storage = new Map();
    const allItemsRef = {current: new Map()};
    const container = renderElements(
      <TestRecoilSync storage={storage} allItemsRef={allItemsRef}>
        <ReadsAtom atom={atomA} />
        <AtomB />
      </TestRecoilSync>,
    );

    expect(container.textContent).toBe('"A""DEFAULT"');
    await flushPromisesAndTimers();

    // Test mapping when syncing default value
    expect(storage.size).toEqual(2);
    expect(storage.has('a')).toEqual(false);
    expect(storage.get('a1')).toEqual('A1');
    expect(storage.get('a2')).toEqual('A2');

    // Test mapping with allItems
    expect(allItemsRef.current.size).toEqual(4);
    expect(allItemsRef.current.get('a1')).toEqual('A1');
    expect(allItemsRef.current.get('a2')).toEqual('A2');
    expect(allItemsRef.current.get('b1')).toEqual(new DefaultValue());
    expect(allItemsRef.current.get('b2')).toEqual(new DefaultValue());

    // Test mapping when writing state changes
    act(() => setB('B'));
    expect(container.textContent).toBe('"A""B"');
    expect(storage.size).toEqual(4);
    expect(storage.has('b')).toEqual(false);
    expect(storage.get('b1')).toEqual('B1');
    expect(storage.get('b2')).toEqual('B2');
    expect(allItemsRef.current.size).toEqual(4);
    expect(allItemsRef.current.get('b1')).toEqual('B1');
    expect(allItemsRef.current.get('b2')).toEqual('B2');

    // Test mapping when reseting state
    act(resetB);
    expect(container.textContent).toBe('"A""DEFAULT"');
    expect(storage.size).toEqual(2);
    expect(storage.has('b')).toEqual(false);
    expect(storage.has('b1')).toEqual(false);
    expect(storage.has('b2')).toEqual(false);
    expect(allItemsRef.current.size).toEqual(4);
    expect(allItemsRef.current.get('b1')).toEqual(new DefaultValue());
    expect(allItemsRef.current.get('b2')).toEqual(new DefaultValue());
  });

  test('read while writing', async () => {
    const myAtom = atom({
      key: 'recoil-sync read while writing',
      default: 'SELF',
      effects: [
        syncEffect({
          refine: string(),
          write: ({write, read}, newValue) => {
            if (newValue instanceof DefaultValue) {
              write('self', newValue);
              return;
            }
            write('self', 'TMP');
            expect(read('self')).toEqual('TMP');
            write('self', `${String(read('other'))}_${newValue}`);
          },
          syncDefault: true,
        }),
      ],
    });

    const storage = new Map([['other', 'OTHER']]);

    const container = renderElements(
      <TestRecoilSync storage={storage}>
        <ReadsAtom atom={myAtom} />
      </TestRecoilSync>,
    );

    expect(container.textContent).toBe('"SELF"');
    await flushPromisesAndTimers();

    expect(storage.size).toEqual(2);
    expect(storage.get('self')).toEqual('OTHER_SELF');
  });

  test('read from multiple items', () => {
    const myAtom = atom({
      key: 'recoil-sync read from multiple',
      default: 'DEFAULT',
      effects: [
        syncEffect({
          refine: dict(number()),
          read: ({read}) => ({a: read('a'), b: read('b')}),
        }),
      ],
    });

    const storage = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    let updateItem;
    const container = renderElements(
      <TestRecoilSync
        storage={storage}
        regListen={listenInterface => {
          updateItem = listenInterface.updateItem;
        }}>
        <ReadsAtom atom={myAtom} />
      </TestRecoilSync>,
    );

    // Test mapping while initializing values
    expect(container.textContent).toBe('{"a":1,"b":2}');

    // Test subscribing to multiple items
    act(() => updateItem('a', 10));
    expect(container.textContent).toBe('{"a":10,"b":2}');

    // Avoid feedback loops
    expect(storage.get('a')).toEqual(1);
    storage.set('a', 10); // Keep storage in sync

    act(() => updateItem('b', 20));
    expect(container.textContent).toBe('{"a":10,"b":20}');
  });
});

// Currently useRecoilSync() must be called in React component tree
// before the first use of atoms to be initialized.
// This is why we only expose <RecoilSync> and not useRecoilSync().
test('Reading before sync hook', async () => {
  const atoms = atomFamily({
    key: 'recoil-sync order',
    default: 'DEFAULT',
    effects: param => [syncEffect({itemKey: param, refine: string()})],
  });

  function SyncOrder() {
    const b = useRecoilValue(atoms('b'));
    useRecoilSync({read: itemKey => itemKey.toUpperCase()});
    const c = useRecoilValue(atoms('c'));
    return (
      <div>
        {String(b)}
        {String(c)}
        <ReadsAtom atom={atoms('d')} />
      </div>
    );
  }

  function MyRoot() {
    return (
      <div>
        <ReadsAtom atom={atoms('a')} />
        <SyncOrder />
        <ReadsAtom atom={atoms('e')} />
      </div>
    );
  }

  const container = renderElements(<MyRoot />);

  expect(container.textContent).toBe('"DEFAULT"DEFAULTC"D""E"');
});

test('Sibling <RecoilRoot>', async () => {
  const atomA = atom({
    key: 'recoil-sync sibling root A',
    default: 'DEFAULT',
    effects: [syncEffect({itemKey: 'a', refine: string(), syncDefault: true})],
  });

  const atomB = atom({
    key: 'recoil-sync sibling root B',
    default: 'DEFAULT',
    effects: [syncEffect({itemKey: 'b', refine: string(), syncDefault: true})],
  });

  const atomShared = atom({
    key: 'recoil-sync sibling root shared',
    default: 'DEFAULT',
    effects: [
      syncEffect({itemKey: 'shared', refine: string(), syncDefault: true}),
    ],
  });

  const storageA = new Map([['a', 'A']]);
  const storageB = new Map([['shared', 'SHARED']]);

  const [AtomA, setA] = componentThatReadsAndWritesAtom(atomA);
  const [AtomB, setB] = componentThatReadsAndWritesAtom(atomB);
  const [SharedInA, setSharedInA] = componentThatReadsAndWritesAtom(atomShared);
  const [SharedInB, setSharedInB] = componentThatReadsAndWritesAtom(atomShared);
  const container = renderElements(
    <>
      <RecoilRoot>
        <TestRecoilSync storage={storageA} />
        <AtomA />
        <SharedInA />
      </RecoilRoot>
      <RecoilRoot>
        <AtomB />
        <TestRecoilSync storage={storageB} />
        <SharedInB />
      </RecoilRoot>
    </>,
  );

  expect(container.textContent).toEqual('"A""DEFAULT""DEFAULT""SHARED"');
  await flushPromisesAndTimers();
  expect(storageA.size).toBe(2);
  expect(storageB.size).toBe(1);
  expect(storageA.get('a')).toBe('A');
  expect(storageA.get('shared')).toBe('DEFAULT');
  expect(storageB.get('shared')).toBe('SHARED');

  act(() => setA('SET_A'));
  expect(container.textContent).toEqual('"SET_A""DEFAULT""DEFAULT""SHARED"');
  expect(storageA.size).toBe(2);
  expect(storageB.size).toBe(1);
  expect(storageA.get('a')).toBe('SET_A');
  expect(storageA.get('shared')).toBe('DEFAULT');
  expect(storageB.get('shared')).toBe('SHARED');

  act(() => setB('SET_B'));
  expect(container.textContent).toEqual('"SET_A""DEFAULT""SET_B""SHARED"');
  expect(storageA.size).toBe(2);
  expect(storageB.size).toBe(2);
  expect(storageA.get('a')).toBe('SET_A');
  expect(storageA.get('shared')).toBe('DEFAULT');
  expect(storageB.get('b')).toBe('SET_B');
  expect(storageB.get('shared')).toBe('SHARED');

  act(() => setSharedInA('SHARED_A'));
  expect(container.textContent).toEqual('"SET_A""SHARED_A""SET_B""SHARED"');
  expect(storageA.size).toBe(2);
  expect(storageB.size).toBe(2);
  expect(storageA.get('a')).toBe('SET_A');
  expect(storageA.get('shared')).toBe('SHARED_A');
  expect(storageB.get('b')).toBe('SET_B');
  expect(storageB.get('shared')).toBe('SHARED');

  act(() => setSharedInB('SHARED_B'));
  expect(container.textContent).toEqual('"SET_A""SHARED_A""SET_B""SHARED_B"');
  expect(storageA.size).toBe(2);
  expect(storageB.size).toBe(2);
  expect(storageA.get('a')).toBe('SET_A');
  expect(storageA.get('shared')).toBe('SHARED_A');
  expect(storageB.get('b')).toBe('SET_B');
  expect(storageB.get('shared')).toBe('SHARED_B');
});

test('Unregister store and atoms', () => {
  const key = 'recoil-sync unregister';
  const atomCleanups = [];
  const myAtom = atom({
    key,
    default: 'DEFAULT',
    effects: [
      ({storeID}) => {
        expect(registries_FOR_TESTING.getAtomRegistry(storeID).has(key)).toBe(
          false,
        );
      },
      syncEffect({refine: string()}),
      ({storeID}) => {
        expect(registries_FOR_TESTING.getAtomRegistry(storeID).has(key)).toBe(
          true,
        );
        return () => {
          expect(
            registries_FOR_TESTING.getAtomRegistry(storeID).get(key)?.effects
              .size,
          ).toBe(0);
          atomCleanups.push(true);
        };
      },
    ],
  });

  const subscriberRefCounts = [];
  const unregister = jest.fn(idx => {
    subscriberRefCounts[idx]--;
  });
  const register = jest.fn(idx => {
    subscriberRefCounts[idx] = (subscriberRefCounts[idx] ?? 0) + 1;
    return () => unregister(idx);
  });
  function TestSyncUnregister({
    children,
    idx,
  }: {
    children: React.Node,
    idx: number,
  }) {
    const listen = useCallback(() => register(idx), [idx]);
    return <RecoilSync listen={listen}>{children}</RecoilSync>;
  }

  let setNumRoots;
  function MyRoots() {
    const [roots, setRoots] = useState(0);
    setNumRoots = setRoots;
    return Array.from(Array(roots).keys()).map(i => (
      <RecoilRoot key={i}>
        {i}
        <TestSyncUnregister idx={i}>
          <ReadsAtom atom={myAtom} />
        </TestSyncUnregister>
      </RecoilRoot>
    ));
  }

  const container = renderElements(<MyRoots />);
  expect(container.textContent).toEqual('');
  expect(register).toHaveBeenCalledTimes(0);
  expect(unregister).toHaveBeenCalledTimes(0);
  expect(subscriberRefCounts[0]).toEqual(undefined);
  expect(subscriberRefCounts[1]).toEqual(undefined);
  expect(atomCleanups.length).toEqual(0);

  act(() => setNumRoots(1));
  expect(container.textContent).toEqual('0"DEFAULT"');
  expect(register).toHaveBeenCalledTimes(1);
  expect(unregister).toHaveBeenCalledTimes(0);
  expect(subscriberRefCounts[0]).toEqual(1);
  expect(subscriberRefCounts[1]).toEqual(undefined);
  expect(atomCleanups.length).toEqual(0);

  act(() => setNumRoots(2));
  expect(container.textContent).toEqual('0"DEFAULT"1"DEFAULT"');
  expect(register).toHaveBeenCalledTimes(2);
  expect(unregister).toHaveBeenCalledTimes(0);
  expect(subscriberRefCounts[0]).toEqual(1);
  expect(subscriberRefCounts[1]).toEqual(1);
  expect(atomCleanups.length).toEqual(0);

  act(() => setNumRoots(1));
  expect(container.textContent).toEqual('0"DEFAULT"');
  expect(register).toHaveBeenCalledTimes(2);
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(subscriberRefCounts[0]).toEqual(1);
  expect(subscriberRefCounts[1]).toEqual(0);
  expect(atomCleanups.length).toEqual(1);

  act(() => setNumRoots(0));
  expect(container.textContent).toEqual('');
  expect(register).toHaveBeenCalledTimes(2);
  expect(unregister).toHaveBeenCalledTimes(2);
  expect(subscriberRefCounts[0]).toEqual(0);
  expect(subscriberRefCounts[1]).toEqual(0);
  expect(atomCleanups.length).toEqual(2);
});

import argparse,json
REQUIRED={'build','native','integration','successor','audit'}
def verify(needs):
    if set(needs)!=REQUIRED or any(needs[name].get('result')!='success' for name in REQUIRED):
        raise ValueError('Every required qualification child must succeed; missing, failed, cancelled and skipped results fail closed')
    return {'status':'PASS','children':sorted(REQUIRED),'scope':'same-workflow exact-artifact qualification; not physical/live qualification'}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--needs',required=True);a=p.parse_args();print(json.dumps(verify(json.loads(a.needs))))

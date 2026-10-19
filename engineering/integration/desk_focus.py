"""Static exact-desk keyboard contract. This is not browser execution evidence."""
from html.parser import HTMLParser

NATIVE_VIEWPORT = (1024, 768)


def desk_actions(quantities, *, table_focusable=False):
    """Plan keyboard input for the explicitly selected table overflow state."""
    actions=[{'type':'move','x':500,'y':300}]
    if table_focusable:actions.append({'type':'keypress','keys':['TAB']})
    for supplier in ['stellar','laurentian','boreal']:
        actions.extend([{'type':'keypress','keys':['TAB']},{'type':'keypress','keys':['CTRL','A']},{'type':'type','text':str(quantities.get(supplier,0))}])
    actions.extend([{'type':'keypress','keys':['TAB']},{'type':'keypress','keys':['ENTER']},{'type':'scroll','x':900,'y':700,'scroll_x':0,'scroll_y':450},{'type':'wait'}])
    return actions


class FocusableElements(HTMLParser):
    def __init__(self):super().__init__();self.elements=[]
    def handle_starttag(self,tag,attributes):
        attrs=dict(attributes)
        if 'hidden' in attrs or 'disabled' in attrs:return
        index=attrs.get('tabindex')
        if index is not None:
            if int(index)<0:return
            if int(index)>0:raise ValueError('POSITIVE_TAB_ORDER_REQUIRES_NEW_FIXTURE')
        if index is not None or tag in {'input','button','select','textarea','summary'} or tag=='a' and 'href' in attrs:
            self.elements.append({'tag':tag,'id':attrs.get('id'),'role':attrs.get('role'),'tabindex':index})


def inspect_desk_focus(handoff,actions, *, table_focusable=False):
    parser=FocusableElements();parser.feed(handoff['task']['html']);elements=parser.elements
    expected=[{'tag':'div','id':None,'role':'region','tabindex':'0'}]+[{'tag':'input','id':'cm-qty-'+name,'role':None,'tabindex':None} for name in ['stellar','laurentian','boreal']]
    if elements[:4]!=expected:raise ValueError('DESK_FOCUS_ORDER_CHANGED')
    if len(elements)<5 or elements[4]['id']!='cm-desk-evaluate' or elements[4]['tag']!='button':raise ValueError('DESK_EVALUATE_FOCUS_CHANGED')
    prefix=[{'type':'move','x':500,'y':300}]
    if table_focusable:prefix.append({'type':'keypress','keys':['TAB']})
    if actions[:len(prefix)]!=prefix:raise ValueError('DESK_FOCUS_PREFIX_CHANGED')
    for index in range(3):
        start=len(prefix)+index*3;group=actions[start:start+3]
        if len(group)!=3 or group[0]!={'type':'keypress','keys':['TAB']} or group[1]!={'type':'keypress','keys':['CTRL','A']} or group[2].get('type')!='type':raise ValueError('DESK_INPUT_ACTIONS_CHANGED')
    if actions[len(prefix)+9:len(prefix)+11]!=[{'type':'keypress','keys':['TAB']},{'type':'keypress','keys':['ENTER']}]:raise ValueError('DESK_SUBMIT_ACTIONS_CHANGED')
    return {'schema':'agi-fleet/static-desk-focus-observation/v1','evidenceClass':'STATIC_DOM_FOCUS_CONTRACT_NO_BROWSER_EXECUTION','firstFocusableElements':elements[:5],'tableFocusableAssumption':table_focusable,'nativeViewport':list(NATIVE_VIEWPORT),'plannedActionCount':len(actions),'actualBrowserActions':None,'actualScreenshots':None,'browserAcceptanceStillRequired':True}
